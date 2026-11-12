// SPDX-License-Identifier: MIT
import { z } from 'zod';

/** `POST …/test-retrieval`: the admin's question, bounded like a visitor message. */
export const testRetrievalSchema = z.object({
  query: z.string().trim().min(1).max(2000),
});

/** One scored candidate; `preview` is the first 300 characters of the chunk. */
export const retrievalResultSchema = z.object({
  rank: z.number().int().min(1),
  score: z.number(),
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
  threshold: z.number(),
  results: z.array(retrievalResultSchema),
});

export type TestRetrievalRequest = z.infer<typeof testRetrievalSchema>;
export type RetrievalResult = z.infer<typeof retrievalResultSchema>;
export type TestRetrievalResponse = z.infer<typeof testRetrievalResponseSchema>;
