// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppError } from '../../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../../common/ports/audit';
import type { UserId, WorkspaceId } from '../../../db/ids';
import { JobsService } from '../../../jobs';
import { ModelCatalog } from '../../../providers';
import { BotsRepository } from '../../bots';
import { REEMBED_BOT_JOB } from '../../bots';
import { CredentialsService } from '../../credentials';

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
      // No singleton key: a second start must run even while the first is active, because it
      // is the one that cancels the first through the generation bump.
      const generation = await this.bots.markReembedPending(manager, {
        workspaceId,
        botId,
        model: target.model,
        credentialId: target.credentialId,
        dim: info.dimensions,
      });
      await this.jobs.enqueue(
        REEMBED_BOT_JOB,
        {
          workspaceId,
          botId,
          targetModel: target.model,
          targetCredentialId: target.credentialId,
          generation,
        },
        { manager },
      );
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
