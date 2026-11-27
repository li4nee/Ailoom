// SPDX-License-Identifier: AGPL-3.0-only
import type { RetrievedChunk } from './retrieval.repository';

export const RERANKER = Symbol('RERANKER');

export interface RerankCandidate {
  chunk: RetrievedChunk;
  score: number;
}

/** Score the bounded hybrid candidate set with a query-passage cross-encoder. */
export interface Reranker {
  score(query: string, passages: readonly RetrievedChunk[], signal: AbortSignal): Promise<number[]>;
}

export interface RerankOutcome {
  chunks: RetrievedChunk[];
  applied: boolean;
  durationMs: number;
  failure: 'invalid_scores' | 'unavailable' | 'timeout' | null;
}

/** Keep the original order on every failure and use stable original ranks to break ties. */
export async function rerankCandidates(
  reranker: Reranker,
  query: string,
  chunks: readonly RetrievedChunk[],
  signal: AbortSignal,
  timeoutMs = 2_500,
): Promise<RerankOutcome> {
  const startedAt = performance.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new Error('reranking_aborted'));
    };
    if (combined.aborted) {
      onAbort();
    } else combined.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const scores = await Promise.race([reranker.score(query, chunks, combined), abortPromise]);
    if (scores.length !== chunks.length || scores.some((score) => !Number.isFinite(score))) {
      return {
        chunks: [...chunks],
        applied: false,
        durationMs: performance.now() - startedAt,
        failure: 'invalid_scores',
      };
    }
    const ranked: RerankCandidate[] = chunks.map((chunk, index) => ({
      chunk,
      score: scores[index] ?? Number.NEGATIVE_INFINITY,
    }));
    ranked.sort((left, right) => right.score - left.score || left.chunk.rank - right.chunk.rank);
    return {
      chunks: ranked.map(({ chunk, score }, index) => ({
        ...chunk,
        originalRank: chunk.rank,
        rerankScore: score,
        rank: index + 1,
      })),
      applied: true,
      durationMs: performance.now() - startedAt,
      failure: null,
    };
  } catch {
    return {
      chunks: [...chunks],
      applied: false,
      durationMs: performance.now() - startedAt,
      failure: timeout.aborted ? 'timeout' : 'unavailable',
    };
  } finally {
    // Do not leave an abort listener waiting for the deadline after scoring finishes.
    if (onAbort !== undefined) combined.removeEventListener('abort', onAbort);
  }
}
