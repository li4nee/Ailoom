// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Clock } from '../../../common/clock';
import { asWorkspaceId } from '../../../db/ids';
import { type JobHandler, JobProcessor } from '../../../jobs';
import { Llm, ModelCatalog, ProviderError } from '../../../providers';
import { BotsRepository } from '../../bots/bots.repository';
import { CredentialsService } from '../../credentials';
import { PricingService } from '../../usage/pricing.service';
import { UsageRepository } from '../../usage/usage.repository';
import { ChunksRepository } from '../chunks.repository';
import { DocumentsRepository } from '../documents.repository';
import { chunkMarkdown } from '../domain/chunker';
import { errorMessageFor } from '../errors';
import { EMBED_CHUNKS_JOB } from '../knowledge.jobs';
import { SourcesRepository } from '../sources.repository';
import { VersionsRepository } from '../versions.repository';
import { ProgressService } from './progress.service';
import { VersioningService } from './versioning.service';

export interface EmbedChunksPayload {
  workspaceId: string;
  botId: string;
  documentVersionId: string;
  embeddingModel: string;
}

/** Spec §12.5: 64 inputs per call; the local model keeps batches at 16 to bound memory. */
export const EMBED_BATCH_SIZE = 64;
export const LOCAL_EMBED_BATCH_SIZE = 16;

/**
 * Chunks a recorded document version and embeds every chunk (spec §12.2, §12.4). The version
 * only becomes the document's current one after every row exists, so a search never sees half
 * a document. A retried job finds its rows already written and finishes without calling the
 * provider again.
 */
@Injectable()
@JobProcessor(EMBED_CHUNKS_JOB)
export class EmbedChunksProcessor implements JobHandler<EmbedChunksPayload> {
  constructor(
    private readonly ds: DataSource,
    private readonly chunks: ChunksRepository,
    private readonly documents: DocumentsRepository,
    private readonly versions: VersionsRepository,
    private readonly sources: SourcesRepository,
    private readonly bots: BotsRepository,
    private readonly versioning: VersioningService,
    private readonly progress: ProgressService,
    private readonly credentials: CredentialsService,
    private readonly llm: Llm,
    private readonly pricing: PricingService,
    private readonly usage: UsageRepository,
    private readonly clock: Clock,
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

    const already = await this.chunks.countForVersion(
      workspaceId,
      payload.documentVersionId,
      payload.embeddingModel,
    );
    if (already > 0) {
      await this.versioning.swapCurrentVersion(workspaceId, document.id, version.id);
      return;
    }

    const drafts = chunkMarkdown({
      title: document.title ?? source.title,
      markdown: version.content,
    });
    if (drafts.length === 0) {
      await this.versioning.swapCurrentVersion(workspaceId, document.id, version.id);
      return;
    }

    const credential = await this.credentials.get(workspaceId, bot.embeddingCredentialId);
    const dim = ModelCatalog.embedding(credential.provider, payload.embeddingModel)?.dimensions;
    if (dim === undefined) {
      await this.progress.fail(workspaceId, source.id, errorMessageFor('model_not_found'));
      return;
    }

    const batchSize = credential.provider === 'local' ? LOCAL_EMBED_BATCH_SIZE : EMBED_BATCH_SIZE;
    const day = this.clock.now().toISOString().slice(0, 10);

    try {
      for (let offset = 0; offset < drafts.length; offset += batchSize) {
        const batch = drafts.slice(offset, offset + batchSize);
        const embedded = await this.llm.embed({
          workspaceId,
          credentialId: credential.id as never,
          model: payload.embeddingModel,
          inputs: batch.map((draft) => draft.embedText),
          purpose: 'document',
          signal: ctx.signal,
        });
        const rows = batch.map((draft, index) => ({
          ...draft,
          embedding: embedded.vectors[index] ?? [],
        }));
        const cost = await this.pricing.cost(workspaceId, {
          embedding: {
            provider: credential.provider,
            model: payload.embeddingModel,
            tokens: embedded.tokens,
          },
        });

        await this.ds.transaction(async (manager) => {
          await this.chunks.insertMany(manager, {
            workspaceId,
            botId: payload.botId,
            documentVersionId: payload.documentVersionId,
            embeddingModel: payload.embeddingModel,
            embeddingDim: dim,
            rows,
          });
          await this.usage.increment(
            manager,
            { workspaceId, botId: payload.botId, day },
            { embeddingTokens: embedded.tokens, costUsd: cost.costUsd },
          );
        });
      }

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
