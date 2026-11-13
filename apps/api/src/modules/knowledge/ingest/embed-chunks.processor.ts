// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';

import { asWorkspaceId } from '../../../db/ids';
import { type JobHandler, JobProcessor } from '../../../jobs';
import { ModelCatalog, ProviderError } from '../../../providers';
import { BotsRepository } from '../../bots';
import { CredentialsService } from '../../credentials';
import { DocumentsRepository } from '../documents.repository';
import { errorMessageFor } from '../errors';
import { EMBED_CHUNKS_JOB } from '../knowledge.jobs';
import { SourcesRepository } from '../sources.repository';
import { VersionsRepository } from '../versions.repository';
import { type EmbedTarget, EmbedVersionService } from './embed-version.service';
import { ProgressService } from './progress.service';
import { VersioningService } from './versioning.service';

export interface EmbedChunksPayload {
  workspaceId: string;
  botId: string;
  documentVersionId: string;
  embeddingModel: string;
}

/**
 * Chunks a recorded document version and embeds every chunk (spec §12.2, §12.4). The version
 * only becomes the document's current one after every row exists, so a search never sees half
 * a document. A retried job resumes the ordinals it has not written yet, so a crash mid-run
 * cannot make a partial version current. During a re-embed the pending model is embedded too
 * (spec §12.7 step 4).
 */
@Injectable()
@JobProcessor(EMBED_CHUNKS_JOB)
export class EmbedChunksProcessor implements JobHandler<EmbedChunksPayload> {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly documents: DocumentsRepository,
    private readonly sources: SourcesRepository,
    private readonly bots: BotsRepository,
    private readonly versions: VersionsRepository,
    private readonly embedVersion: EmbedVersionService,
    private readonly versioning: VersioningService,
    private readonly progress: ProgressService,
  ) {}

  async handle(payload: EmbedChunksPayload, ctx: { signal: AbortSignal }): Promise<void> {
    const workspaceId = asWorkspaceId(payload.workspaceId);
    const document = await this.documents.findByVersionId(workspaceId, payload.documentVersionId);
    if (document === null) return;
    const source = await this.sources.findById(workspaceId, document.sourceId);
    if (source === null) return;
    if (source.status === 'deleting') return;
    const bot = await this.bots.findById(workspaceId, source.botId);
    if (bot === null) return;
    if (bot.deletedAt !== null) return;

    const version = await this.versions.findById(workspaceId, payload.documentVersionId);
    if (version === null) return;

    const targets: EmbedTarget[] = [];
    // Retrieval filters on the bot's active model, so the primary target must come from the
    // bot as it is now, not from the model this job was queued under: a re-embed can finish
    // between enqueueing a page and embedding it. The payload model is only a fallback for a
    // row that has no active model.
    const primaryModel = bot.embeddingModel === '' ? payload.embeddingModel : bot.embeddingModel;
    const credential = await this.credentials.get(workspaceId, bot.embeddingCredentialId);
    const dim = ModelCatalog.embedding(credential.provider, primaryModel)?.dimensions;
    if (dim === undefined) {
      await this.progress.fail(workspaceId, source.id, errorMessageFor('model_not_found'));
      return;
    }
    targets.push({
      model: primaryModel,
      credentialId: bot.embeddingCredentialId,
      dim,
    });
    if (
      bot.pendingEmbeddingModel !== null &&
      bot.pendingEmbeddingModel !== primaryModel &&
      bot.pendingEmbeddingCredentialId !== null &&
      bot.pendingEmbeddingDim !== null
    ) {
      targets.push({
        model: bot.pendingEmbeddingModel,
        credentialId: bot.pendingEmbeddingCredentialId,
        dim: bot.pendingEmbeddingDim,
      });
    }

    try {
      await this.embedVersion.embed({
        workspaceId,
        botId: payload.botId,
        title: document.title ?? source.title,
        version,
        targets,
        signal: ctx.signal,
      });

      await this.versioning.swapCurrentVersion(workspaceId, document.id, version.id);
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'auth_failed') {
        // Retrying cannot fix a rejected key (spec §12.5): fail the source once.
        await this.progress.fail(workspaceId, source.id, errorMessageFor('auth_failed'));
        return;
      }
      throw error;
    }
  }
}
