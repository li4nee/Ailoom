// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { rerankCandidates, type Reranker } from './reranker';
import type { RetrievedChunk } from './retrieval.repository';

const chunks: RetrievedChunk[] = [
  {
    chunkId: 'a',
    documentId: 'doc-a',
    title: 'A',
    url: null,
    headingPath: '',
    content: 'a',
    metadata: {},
    score: 0.9,
    rank: 1,
  },
  {
    chunkId: 'b',
    documentId: 'doc-b',
    title: 'B',
    url: null,
    headingPath: '',
    content: 'b',
    metadata: {},
    score: 0.8,
    rank: 2,
  },
  {
    chunkId: 'c',
    documentId: 'doc-c',
    title: 'C',
    url: null,
    headingPath: '',
    content: 'c',
    metadata: {},
    score: 0.7,
    rank: 3,
  },
];

describe('rerankCandidates', () => {
  it('reorders by cross-encoder score while retaining source scores and original ranks', async () => {
    const reranker: Reranker = { score: vi.fn().mockResolvedValue([0.1, 0.9, 0.9]) };
    const result = await rerankCandidates(
      reranker,
      'question',
      chunks,
      new AbortController().signal,
    );
    expect(result.applied).toBe(true);
    expect(
      result.chunks.map((chunk) => [
        chunk.chunkId,
        chunk.rank,
        chunk.originalRank,
        chunk.rerankScore,
      ]),
    ).toEqual([
      ['b', 1, 2, 0.9],
      ['c', 2, 3, 0.9],
      ['a', 3, 1, 0.1],
    ]);
    expect(result.chunks.map((chunk) => chunk.score)).toEqual([0.8, 0.7, 0.9]);
  });

  it('keeps the hybrid order on invalid scores and inference failures', async () => {
    const invalid: Reranker = { score: vi.fn().mockResolvedValue([Number.NaN]) };
    const failed: Reranker = { score: vi.fn().mockRejectedValue(new Error('model unavailable')) };
    for (const [reranker, failure] of [
      [invalid, 'invalid_scores'],
      [failed, 'unavailable'],
    ] as const) {
      const result = await rerankCandidates(
        reranker,
        'question',
        chunks,
        new AbortController().signal,
      );
      expect(result.applied).toBe(false);
      expect(result.failure).toBe(failure);
      expect(result.chunks).toEqual(chunks);
    }
  });

  it('falls back when scoring exceeds the request budget', async () => {
    const stalled: Reranker = { score: vi.fn(() => new Promise<number[]>(() => undefined)) };
    const result = await rerankCandidates(
      stalled,
      'question',
      chunks,
      new AbortController().signal,
      1,
    );
    expect(result.applied).toBe(false);
    expect(result.failure).toBe('timeout');
    expect(result.chunks).toEqual(chunks);
  });
});
