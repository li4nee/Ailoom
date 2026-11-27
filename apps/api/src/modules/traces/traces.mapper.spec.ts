// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { traceDetailSchema } from '@app/shared';

import { toTraceDetail } from './traces.mapper';
import type { TraceDetailRow, TraceRetrievalRowRaw } from './traces.repository';

describe('toTraceDetail', () => {
  it('omits nullable rerank fields unless the retrieval row has a rerank score', () => {
    const row: TraceDetailRow = {
      id: 'trace-1',
      decision: 'answered',
      decision_reason: null,
      origin: 'widget',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      prompt_version_id: null,
      prompt_version_number: null,
      prompt_system_prompt: null,
      platform_prompt_version: null,
      chat_provider: 'mock',
      chat_model: 'mock-chat',
      embedding_provider: 'mock',
      embedding_model: 'mock-embed',
      retrieval_mode: 'vector',
      retrieval_ms: 12,
      reranking_applied: false,
      reranking_ms: 0,
      reranking_failure: null,
      retrieval_cost_usd: '0.000000',
      request_snapshot: null,
      tool_calls: [],
      input_tokens: 1,
      output_tokens: 1,
      embedding_tokens: 1,
      cost_usd: '0.000000',
      latency_ms: 12,
      ttft_ms: 1,
      error: null,
      feedback: null,
      conversation_status: 'ai',
    };
    const retrieval: TraceRetrievalRowRaw[] = [
      {
        rank: 1,
        score: 0.8,
        used: true,
        chunk_id: 'chunk-1',
        document_id: 'doc-1',
        source_title: 'Refund policy',
        preview: 'Refunds within 30 days.',
        vector_rank: null,
        keyword_rank: null,
        fusion_score: null,
        original_rank: null,
        rerank_score: null,
      },
    ];

    const result = toTraceDetail(row, retrieval, true);

    expect(result.retrieval[0]).not.toHaveProperty('originalRank');
    expect(result.retrieval[0]).not.toHaveProperty('rerankScore');
    expect(traceDetailSchema.parse(result)).toEqual(result);
  });
});
