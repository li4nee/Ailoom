// SPDX-License-Identifier: MIT
import { z } from 'zod';

/** `POST …/test-retrieval`: the admin's question, bounded like a visitor message. */
export const testRetrievalSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  retrievalMode: z.enum(['vector', 'hybrid']).optional(),
  threshold: z.number().min(0).max(1).optional(),
});

export const RETRIEVAL_MODES = ['vector', 'hybrid'] as const;
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

/** One scored candidate; `preview` is the first 300 characters of the chunk. */
export const retrievalResultSchema = z.object({
  rank: z.number().int().min(1),
  score: z.number(),
  vectorRank: z.number().int().positive().nullable().optional(),
  keywordRank: z.number().int().positive().nullable().optional(),
  fusionScore: z.number().nonnegative().optional(),
  used: z.boolean(),
  chunkId: z.string(),
  documentId: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  headingPath: z.string(),
  preview: z.string(),
});

/** What the panel shows: the model it embedded with, the threshold, and the candidates. */
export const testRetrievalResponseSchema = z.object({
  embeddingModel: z.string(),
  retrievalMode: z.enum(RETRIEVAL_MODES).default('vector'),
  threshold: z.number(),
  results: z.array(retrievalResultSchema),
});

/** Retrieval returns 8 candidates; the prompt uses the top 5 at or above the threshold. */
export const USED_CHUNKS_MAX = 5;

/**
 * The chunks chat would put in the prompt (spec §13.1): at or above the bot's threshold, in
 * rank order, capped at five. Lives here so the admin's threshold slider applies exactly the
 * same rule the API and chat engine use.
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

export type TestRetrievalRequest = z.infer<typeof testRetrievalSchema>;
export type RetrievalResult = z.infer<typeof retrievalResultSchema>;
export type TestRetrievalResponse = z.infer<typeof testRetrievalResponseSchema>;
