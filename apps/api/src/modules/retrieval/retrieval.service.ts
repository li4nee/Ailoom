// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { ProviderKind } from '@app/shared';

export { selectUsedChunks, USED_CHUNKS_MAX } from '@app/shared';

import { Clock } from '../../common/clock';
import { asBotId, type WorkspaceId } from '../../db/ids';
import { Llm } from '../../providers';
import type { BotEntity } from '../bots';
import { PricingService, UsageRepository } from '../usage';
import { RetrievalRepository, type RetrievedChunk } from './retrieval.repository';

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  topScore: number | null;
  embeddingTokens: number;
  queryVector: number[];
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
