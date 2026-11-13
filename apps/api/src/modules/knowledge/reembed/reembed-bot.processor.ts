// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppError } from '../../../common/errors';
import { asWorkspaceId } from '../../../db/ids';
import { type JobHandler, JobProcessor } from '../../../jobs';
import { BotsRepository } from '../../bots';
import { REEMBED_BOT_JOB } from '../../bots';
import { notifyWorkspace } from '../../realtime';
import { EmbedVersionService } from '../ingest/embed-version.service';
import { VersionsRepository } from '../versions.repository';
import { ReembedRepository } from './reembed.repository';

export interface ReembedBotPayload {
  workspaceId: string;
  botId: string;
  targetModel: string;
  targetCredentialId: string;
  generation: number;
}

/**
 * Re-embeds the current version of every document of one bot into rows tagged with the target
 * model (spec §12.7). The bot keeps answering with its old model until the final swap; a newer
 * generation makes this run delete its partial rows and exit before its next batch.
 */
@Injectable()
@JobProcessor(REEMBED_BOT_JOB)
export class ReembedBotProcessor implements JobHandler<ReembedBotPayload> {
  private readonly logger = new Logger(ReembedBotProcessor.name);

  constructor(
    private readonly ds: DataSource,
    private readonly repository: ReembedRepository,
    private readonly bots: BotsRepository,
    private readonly versions: VersionsRepository,
    private readonly embedVersion: EmbedVersionService,
  ) {}

  async handle(payload: ReembedBotPayload, ctx: { signal: AbortSignal }): Promise<void> {
    const workspaceId = asWorkspaceId(payload.workspaceId);
    const bot = await this.bots.findById(workspaceId, payload.botId);
    if (bot === null) return;
    if (bot.deletedAt !== null) return;

    const target = {
      workspaceId,
      botId: payload.botId,
      model: payload.targetModel,
      credentialId: payload.targetCredentialId,
      dim: bot.pendingEmbeddingDim,
    };
    // Another start already superseded this run: drop its partial rows, unless the newer run
    // targets the same model and now owns them.
    if (bot.reembedGeneration !== payload.generation || target.dim === null) {
      if (bot.pendingEmbeddingModel !== payload.targetModel) await this.discard(target);
      return;
    }
    const dim = target.dim;

    const documents = await this.repository.listCurrentDocuments(workspaceId, payload.botId);
    try {
      for (const document of documents) {
        if ((await this.repository.generation(workspaceId, payload.botId)) !== payload.generation) {
          await this.discard(target);
          return;
        }
        const version = await this.versions.findById(workspaceId, document.versionId);
        if (version === null) continue;
        const result = await this.embedVersion.embed({
          workspaceId,
          botId: payload.botId,
          title: document.title,
          version,
          targets: [
            {
              model: payload.targetModel,
              credentialId: payload.targetCredentialId,
              dim,
            },
          ],
          signal: ctx.signal,
          beforeBatch: async () =>
            (await this.repository.generation(workspaceId, payload.botId)) === payload.generation,
        });
        if (result.cancelled) {
          await this.discard(target);
          return;
        }
      }

      const sources = await this.repository.sources(workspaceId, payload.botId);
      await this.ds.transaction(async (manager) => {
        const swapped = await this.repository.swap(manager, {
          workspaceId,
          botId: payload.botId,
          model: payload.targetModel,
          credentialId: payload.targetCredentialId,
          dim,
          generation: payload.generation,
        });
        if (!swapped) return;
        for (const sourceId of sources) {
          await notifyWorkspace(manager, workspaceId, {
            type: 'source.updated',
            sourceId,
            botId: payload.botId,
            status: 'ready',
          });
        }
      });
    } catch (error) {
      // A newer generation owns the pending columns now; do not touch them or fail the bot.
      if ((await this.repository.generation(workspaceId, payload.botId)) !== payload.generation) {
        await this.discard(target);
        return;
      }
      const message =
        error instanceof AppError ? error.code : 'The embedding provider rejected the re-embed.';
      this.logger.warn(`re-embed of bot ${payload.botId} failed: ${message}`);
      await this.discard(target);
      await this.repository.fail(workspaceId, payload.botId, message);
    }
  }

  /** Drops the rows this model wrote, so a failed or superseded run leaves nothing behind. */
  private async discard(target: {
    workspaceId: ReturnType<typeof asWorkspaceId>;
    botId: string;
    model: string;
  }): Promise<void> {
    await this.ds.transaction(async (manager) => {
      await this.repository.deleteChunksForModel(
        manager,
        target.workspaceId,
        target.botId,
        target.model,
      );
    });
  }
}
