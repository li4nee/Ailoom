// SPDX-License-Identifier: AGPL-3.0-only
import type { TraceDetail } from '@app/shared';

import type { TraceDetailRow, TraceRetrievalRowRaw } from './traces.repository';

export function toTraceDetail(
  row: TraceDetailRow,
  retrieval: TraceRetrievalRowRaw[],
  priceKnown: boolean,
): TraceDetail {
  return {
    id: row.id,
    decision: row.decision,
    decisionReason: row.decision_reason,
    origin: row.origin,
    createdAt: row.created_at.toISOString(),
    promptVersion:
      row.prompt_version_id === null ||
      row.prompt_version_number === null ||
      row.prompt_system_prompt === null
        ? null
        : {
            id: row.prompt_version_id,
            version: row.prompt_version_number,
            systemPrompt: row.prompt_system_prompt,
          },
    platformPromptVersion: row.platform_prompt_version,
    chat:
      row.chat_provider === null || row.chat_model === null
        ? null
        : { provider: row.chat_provider, model: row.chat_model },
    embedding:
      row.embedding_provider === null || row.embedding_model === null
        ? null
        : { provider: row.embedding_provider, model: row.embedding_model },
    retrievalMode: row.retrieval_mode,
    retrievalMs: row.retrieval_ms,
    retrievalCostUsd: row.retrieval_cost_usd,
    retrieval: retrieval.map((entry) => ({
      rank: entry.rank,
      score: entry.score,
      used: entry.used,
      vectorRank: entry.vector_rank,
      keywordRank: entry.keyword_rank,
      ...(entry.fusion_score === null ? {} : { fusionScore: entry.fusion_score }),
      chunkId: entry.chunk_id,
      documentId: entry.document_id,
      sourceTitle: entry.source_title,
      preview: entry.preview,
      sourceDeleted: entry.document_id === null,
    })),
    requestSnapshot: row.request_snapshot,
    toolCalls: row.tool_calls ?? [],
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    embeddingTokens: row.embedding_tokens,
    costUsd: row.cost_usd,
    priceKnown,
    latencyMs: row.latency_ms,
    ttftMs: row.ttft_ms,
    error: row.error,
    feedback: row.feedback === 1 || row.feedback === -1 ? row.feedback : null,
  };
}
