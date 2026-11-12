// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { ProviderKind } from '@app/shared';

import { Clock } from '../../common/clock';
import { asBotId, type WorkspaceId } from '../../db/ids';
import { Llm } from '../../providers';
import type { BotEntity } from '../bots';
import { PricingService } from '../usage/pricing.service';
import { UsageRepository } from '../usage/usage.repository';
import { RetrievalRepository, type RetrievedChunk } from './retrieval.repository';

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  topScore: number | null;
  embeddingTokens: number;
  queryVector: number[];
}

/** Retrieval returns 8 candidates; the prompt uses the top 5 at or above the threshold. */
export const RETRIEVAL_LIMIT = 8;
export const USED_CHUNKS_MAX = 5;

/**
 * The chunks the chat engine puts in the prompt: rank order, at or above the bot's threshold,
 * capped at five (spec §13.1). Exported so the admin's test-retrieval panel uses the same rule.
 */
export function selectUsedChunks<T extends { rank: number; score: number }>(
  chunks: T[],
  threshold: number,
  max = USED_CHUNKS_MAX,
): T[] {
  return chunks
    .filter((chunk) => chunk.score >= threshold)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, max);
}

@Injectable()
export class RetrievalService {
  constructor(
    private readonly ds: DataSource,
    private readonly repository: RetrievalRepository,
    private readonly llm: Llm,
    private readonly pricing: PricingService,
    private readonly usage: UsageRepository,
    private readonly clock: Clock,
  ) {}

  /** Embeds the query with the bot's model, then searches only that model's current chunks. */
  async retrieve(
    workspaceId: WorkspaceId,
    bot: BotEntity,
    query: string,
    signal: AbortSignal,
  ): Promise<RetrievalResult> {
    const embedded = await this.llm.embed({
      workspaceId,
      credentialId: bot.embeddingCredentialId as never,
      model: bot.embeddingModel,
      inputs: [query],
      purpose: 'query',
      signal,
    });
    const vector = embedded.vectors[0] ?? [];

    const chunks = await this.repository.search(workspaceId, {
      botId: asBotId(bot.id),
      embeddingModel: bot.embeddingModel,
      dim: bot.embeddingDim,
      vector,
      limit: RETRIEVAL_LIMIT,
    });

    // Query embeddings are billable like any other embedding call (spec §9.5).
    const cost = await this.pricing.cost(workspaceId, {
      embedding: {
        provider: ((await this.repository.providerOf(bot.embeddingCredentialId)) ??
          'unknown') as ProviderKind,
        model: bot.embeddingModel,
        tokens: embedded.tokens,
      },
    });
    await this.ds.transaction(async (manager) => {
      await this.usage.increment(
        manager,
        { workspaceId, botId: bot.id, day: this.clock.now().toISOString().slice(0, 10) },
        { embeddingTokens: embedded.tokens, costUsd: cost.costUsd },
      );
    });

    return {
      chunks,
      topScore: chunks[0]?.score ?? null,
      embeddingTokens: embedded.tokens,
      queryVector: vector,
    };
  }
}
