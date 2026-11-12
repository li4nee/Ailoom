// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { AppError } from '../../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../../common/ports/audit';
import type { UserId, WorkspaceId } from '../../../db/ids';
import { JobsService } from '../../../jobs';
import { ModelCatalog } from '../../../providers';
import { BotsRepository } from '../../bots/bots.repository';
import { CredentialsService } from '../../credentials';
import { REEMBED_BOT_JOB } from '../knowledge.jobs';

/**
 * Marks a bot's new embedding model pending and queues the job. The job is not deduplicated by
 * key: a second start must run even while the first is active, because it is the one that
 * cancels the first via the generation bump.
 */
export async function queueReembed(input: {
  manager: EntityManager;
  jobs: JobsService;
  bots: BotsRepository;
  workspaceId: WorkspaceId;
  botId: string;
  target: { credentialId: string; model: string; dim: number };
}): Promise<number> {
  const generation = await input.bots.markReembedPending(input.manager, {
    workspaceId: input.workspaceId,
    botId: input.botId,
    model: input.target.model,
    credentialId: input.target.credentialId,
    dim: input.target.dim,
  });
  await input.jobs.enqueue(
    REEMBED_BOT_JOB,
    {
      workspaceId: input.workspaceId,
      botId: input.botId,
      targetModel: input.target.model,
      targetCredentialId: input.target.credentialId,
      generation,
    },
    { manager: input.manager },
  );
  return generation;
}

/** Spec §12.7: switching a bot's embedding model re-embeds its corpus in the background. */
@Injectable()
export class ReembedService {
  constructor(
    private readonly ds: DataSource,
    private readonly bots: BotsRepository,
    private readonly credentials: CredentialsService,
    private readonly jobs: JobsService,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
  ) {}

  async start(
    workspaceId: WorkspaceId,
    botId: string,
    target: { credentialId: string; model: string },
    actor: UserId,
  ): Promise<void> {
    const bot = await this.bots.getById(workspaceId, botId);
    if (bot.deletedAt !== null) throw new AppError('not_found');
    if (bot.embeddingCredentialId === target.credentialId && bot.embeddingModel === target.model) {
      return;
    }

    const credential = await this.credentials.get(workspaceId, target.credentialId);
    const info = ModelCatalog.embedding(credential.provider, target.model);
    if (info === null) {
      throw new AppError('validation_failed', {
        message: 'This embedding model is not in the catalog. Pick one from the model list.',
        details: [
          {
            path: 'embeddingModel',
            message: 'This embedding model is not in the catalog. Pick one from the model list.',
          },
        ],
      });
    }

    await this.ds.transaction(async (manager) => {
      await queueReembed({
        manager,
        jobs: this.jobs,
        bots: this.bots,
        workspaceId,
        botId,
        target: { ...target, dim: info.dimensions },
      });
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'bot.updated',
          targetType: 'bot',
          targetId: botId,
          metadata: { changed: ['embeddingModel'], pendingEmbeddingModel: target.model },
        },
        manager,
      );
    });
  }
}
