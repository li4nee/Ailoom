// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { TRACE_DECISIONS, TRACE_ORIGINS } from './enums.js';

/** One retrieval candidate as shown in the replay drawer (spec §17.8). */
export const traceRetrievalRowSchema = z.object({
  rank: z.number().int(),
  score: z.number(),
  used: z.boolean(),
  vectorRank: z.number().int().positive().nullable().optional(),
  keywordRank: z.number().int().positive().nullable().optional(),
  fusionScore: z.number().nonnegative().optional(),
  originalRank: z.number().int().positive().optional(),
  rerankScore: z.number().optional(),
  chunkId: z.string(),
  documentId: z.string().nullable(),
  sourceTitle: z.string().nullable(),
  preview: z.string().nullable(),
  /** The chunk or its document was deleted after the answer was generated. */
  sourceDeleted: z.boolean(),
});

export const traceToolCallSchema = z.object({
  name: z.string(),
  /** Present only for MCP calls and returned only to workspace owners/admins. */
  remoteName: z.string().optional(),
  toolVersion: z.number().int().positive().optional(),
  inputFields: z.array(z.string()),
  outputFields: z.array(z.string()),
  status: z.enum(['started', 'complete', 'failed']),
  durationMs: z.number().int().nonnegative().nullable(),
});

/** Everything an agent sees when they open one AI answer's replay. */
export const traceDetailSchema = z.object({
  id: z.string(),
  decision: z.enum(TRACE_DECISIONS),
  decisionReason: z.string().nullable(),
  origin: z.enum(TRACE_ORIGINS),
  createdAt: z.string(),
  promptVersion: z
    .object({
      id: z.string(),
      version: z.number().int(),
      systemPrompt: z.string(),
    })
    .nullable(),
  platformPromptVersion: z.string().nullable(),
  chat: z.object({ provider: z.string(), model: z.string() }).nullable(),
  embedding: z.object({ provider: z.string(), model: z.string() }).nullable(),
  retrieval: z.array(traceRetrievalRowSchema),
  retrievalMode: z.enum(['vector', 'hybrid']).optional(),
  retrievalMs: z.number().int().nonnegative().nullable().optional(),
  rerankingApplied: z.boolean().optional(),
  rerankingMs: z.number().int().nonnegative().optional(),
  rerankingFailure: z.enum(['invalid_scores', 'unavailable', 'timeout']).nullable().optional(),
  queryRewritingApplied: z.boolean().optional(),
  queryRewritingMs: z.number().int().nonnegative().optional(),
  queryRewritingFailure: z.enum(['invalid_output', 'unavailable', 'timeout']).nullable().optional(),
  retrievalCostUsd: z.string().nullable().optional(),
  /** Redacted tool execution summary; values and endpoint details are never returned. */
  toolCalls: z.array(traceToolCallSchema),
  requestSnapshot: z.unknown(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  embeddingTokens: z.number().int(),
  costUsd: z.string(),
  priceKnown: z.boolean(),
  latencyMs: z.number().int().nullable(),
  ttftMs: z.number().int().nullable(),
  error: z.string().nullable(),
  feedback: z.union([z.literal(1), z.literal(-1)]).nullable(),
});

export type TraceRetrievalRow = z.infer<typeof traceRetrievalRowSchema>;
export type TraceToolCall = z.infer<typeof traceToolCallSchema>;
export type TraceDetail = z.infer<typeof traceDetailSchema>;
