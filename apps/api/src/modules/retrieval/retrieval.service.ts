// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { ProviderKind } from '@app/shared';

export { selectUsedChunks, USED_CHUNKS_MAX } from '@app/shared';

import { Clock } from '../../common/clock';
import { asBotId, type WorkspaceId } from '../../db/ids';
import { Llm } from '../../providers';
import type { BotEntity } from '../bots';
import { PricingService, UsageRepository } from '../usage';
import { RERANKER, rerankCandidates, type Reranker } from './reranker';
import { RetrievalRepository, type RetrievedChunk } from './retrieval.repository';

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  topScore: number | null;
  embeddingTokens: number;
  embeddingProvider: string;
  queryVector: number[];
  retrievalMode: 'vector' | 'hybrid';
  retrievalMs: number;
  retrievalCostUsd: string | null;
  rerankingApplied: boolean;
  rerankingMs: number;
  rerankingFailure: 'invalid_scores' | 'unavailable' | 'timeout' | null;
}

/** Retrieval returns 8 candidates; the prompt uses the top 5 at or above the threshold. */
export const RETRIEVAL_LIMIT = 8;

@Injectable()
export class RetrievalService {
  constructor(
    private readonly ds: DataSource,
    private readonly repository: RetrievalRepository,
    private readonly llm: Llm,
    private readonly pricing: PricingService,
    private readonly usage: UsageRepository,
    private readonly clock: Clock,
    @Optional() @Inject(RERANKER) private readonly reranker?: Reranker,
  ) {}

  /**
   * Embeds the query with the bot's model, then searches only that model's current chunks.
   * `bill: false` lets the chat pipeline account for the query embedding in its single
   * `finalize` write instead of charging it here as well.
   */
  async retrieve(
    workspaceId: WorkspaceId,
    bot: Pick<BotEntity, 'id' | 'embeddingCredentialId' | 'embeddingModel' | 'embeddingDim'> &
      Partial<Pick<BotEntity, 'retrievalMode' | 'retrievalThreshold' | 'rerankingEnabled'>>,
    query: string,
    signal: AbortSignal,
    options: {
      bill?: boolean;
      retrievalMode?: 'vector' | 'hybrid';
      threshold?: number;
      rerankingEnabled?: boolean;
    } = {},
  ): Promise<RetrievalResult> {
    const startedAt = this.clock.now().getTime();
    const embedded = await this.llm.embed({
      workspaceId,
      credentialId: bot.embeddingCredentialId as never,
      model: bot.embeddingModel,
      inputs: [query],
      purpose: 'query',
      signal,
    });
    const vector = embedded.vectors[0] ?? [];

    const searchInput = {
      botId: asBotId(bot.id),
      embeddingModel: bot.embeddingModel,
      dim: bot.embeddingDim,
      vector,
      limit: RETRIEVAL_LIMIT,
      queryText: query,
    };
    const retrievalMode = options.retrievalMode ?? bot.retrievalMode ?? 'vector';
    const providerPromise = this.repository.providerOf(bot.embeddingCredentialId).then(
      (provider) => ({ ok: true as const, provider }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const candidates = await (retrievalMode === 'hybrid'
      ? this.repository.searchHybrid(
          workspaceId,
          searchInput,
          options.threshold ?? bot.retrievalThreshold ?? 0.35,
        )
      : this.repository.search(workspaceId, searchInput));
    const rerankingEnabled = options.rerankingEnabled ?? bot.rerankingEnabled ?? false;
    const reranked =
      retrievalMode === 'hybrid' && rerankingEnabled && this.reranker !== undefined
        ? await rerankCandidates(this.reranker, query, candidates, signal)
        : {
            chunks: candidates,
            applied: false,
            durationMs: 0,
            failure:
              rerankingEnabled && this.reranker === undefined ? ('unavailable' as const) : null,
          };
    const chunks = reranked.chunks;
    const retrievalMs = Math.max(0, this.clock.now().getTime() - startedAt);

    const providerResult = await providerPromise;
    if (!providerResult.ok) throw providerResult.error;
    const provider = providerResult.provider;
    const embeddingProvider = provider ?? 'unknown';
    const cost =
      options.bill === false
        ? null
        : await this.pricing.cost(workspaceId, {
            embedding: {
              provider: embeddingProvider as ProviderKind,
              model: bot.embeddingModel,
              tokens: embedded.tokens,
            },
          });
    if (cost !== null) {
      // Query embeddings are billable like any other embedding call (spec §9.5).
      await this.ds.transaction(async (manager) => {
        await this.usage.increment(
          manager,
          { workspaceId, botId: bot.id, day: this.clock.now().toISOString().slice(0, 10) },
          { embeddingTokens: embedded.tokens, costUsd: cost.costUsd },
        );
      });
    }

    return {
      chunks,
      topScore:
        chunks.length === 0
          ? null
          : Math.max(...chunks.map((chunk) => chunk.maxScore ?? chunk.score)),
      embeddingTokens: embedded.tokens,
      embeddingProvider,
      queryVector: vector,
      retrievalMode,
      retrievalMs,
      retrievalCostUsd: cost?.priceKnown ? cost.costUsd : null,
      rerankingApplied: reranked.applied,
      rerankingMs: reranked.durationMs,
      rerankingFailure: reranked.failure,
    };
  }

  /** Spec §14.1: `no_knowledge` means the bot has no reachable chunks at all. */
  async countReadyChunks(workspaceId: WorkspaceId, bot: BotEntity): Promise<number> {
    return this.repository.countReadyChunks(workspaceId, asBotId(bot.id), bot.embeddingModel);
  }
}
