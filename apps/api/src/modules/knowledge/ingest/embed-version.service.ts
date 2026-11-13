// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Clock } from '../../../common/clock';
import type { WorkspaceId } from '../../../db/ids';
import { Llm } from '../../../providers';
import { CredentialsService } from '../../credentials';
import { PricingService, UsageRepository } from '../../usage';
import { ChunksRepository } from '../chunks.repository';
import { chunkMarkdown } from '../domain/chunker';
import type { DocumentVersionEntity } from '../entities/document-version.entity';

export interface EmbedTarget {
  model: string;
  credentialId: string;
  dim: number;
}

/** 64 inputs per call; the local model keeps batches at 16 to bound memory (spec §12.5). */
export const EMBED_BATCH_SIZE = 64;
export const LOCAL_EMBED_BATCH_SIZE = 16;

/**
 * Embeds one document version for one or more models. Ingestion passes the active model plus,
 * during a re-embed, the pending one (spec §12.7 step 4); the re-embed job passes only its
 * target. `beforeBatch` lets the re-embed job stop between batches once a newer generation
 * exists; the caller deletes whatever the cancelled run wrote.
 */
@Injectable()
export class EmbedVersionService {
  constructor(
    private readonly ds: DataSource,
    private readonly chunks: ChunksRepository,
    private readonly credentials: CredentialsService,
    private readonly llm: Llm,
    private readonly pricing: PricingService,
    private readonly usage: UsageRepository,
    private readonly clock: Clock,
  ) {}

  async embed(input: {
    workspaceId: WorkspaceId;
    botId: string;
    title: string;
    version: DocumentVersionEntity;
    targets: EmbedTarget[];
    signal: AbortSignal;
    beforeBatch?: () => Promise<boolean>;
  }): Promise<{ cancelled: boolean }> {
    const drafts = chunkMarkdown({ title: input.title, markdown: input.version.content });
    const day = this.clock.now().toISOString().slice(0, 10);

    for (const target of input.targets) {
      if (drafts.length === 0) break;
      // A job killed mid-run leaves part of the version behind. Resume the missing ordinals
      // instead of accepting the partial set as done: the version is about to become current,
      // and in the re-embed path the swap later deletes the old model's rows.
      const existing = new Set(
        await this.chunks.ordinalsForVersion(input.workspaceId, input.version.id, target.model),
      );
      const missing = drafts.filter((draft) => !existing.has(draft.ordinal));
      if (missing.length === 0) continue;

      const credential = await this.credentials.get(input.workspaceId, target.credentialId);
      const batchSize = credential.provider === 'local' ? LOCAL_EMBED_BATCH_SIZE : EMBED_BATCH_SIZE;

      for (let offset = 0; offset < missing.length; offset += batchSize) {
        if (input.beforeBatch !== undefined && !(await input.beforeBatch())) {
          return { cancelled: true };
        }
        const batch = missing.slice(offset, offset + batchSize);
        const embedded = await this.llm.embed({
          workspaceId: input.workspaceId,
          credentialId: target.credentialId as never,
          model: target.model,
          inputs: batch.map((draft) => draft.embedText),
          purpose: 'document',
          signal: input.signal,
        });
        const rows = batch.map((draft, index) => ({
          ...draft,
          embedding: embedded.vectors[index] ?? [],
        }));
        const cost = await this.pricing.cost(input.workspaceId, {
          embedding: {
            provider: credential.provider,
            model: target.model,
            tokens: embedded.tokens,
          },
        });

        await this.ds.transaction(async (manager) => {
          await this.chunks.insertMany(manager, {
            workspaceId: input.workspaceId,
            botId: input.botId,
            documentVersionId: input.version.id,
            embeddingModel: target.model,
            embeddingDim: target.dim,
            rows,
          });
          await this.usage.increment(
            manager,
            { workspaceId: input.workspaceId, botId: input.botId, day },
            { embeddingTokens: embedded.tokens, costUsd: cost.costUsd },
          );
        });
      }
    }

    return { cancelled: false };
  }
}
