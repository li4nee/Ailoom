// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { selectUsedChunks } from './retrieval.service';

function chunk(rank: number, score: number): { rank: number; score: number } {
  return { rank, score };
}

describe('selectUsedChunks', () => {
  it('keeps at most five chunks at or above the threshold, in rank order', () => {
    const candidates = [
      chunk(3, 0.9),
      chunk(1, 0.9),
      chunk(2, 0.2),
      chunk(6, 0.99),
      chunk(4, 0.5),
      chunk(5, 0.4),
      chunk(7, 0.8),
    ];

    expect(selectUsedChunks(candidates, 0.35).map((c) => c.rank)).toEqual([1, 3, 4, 5, 6]);
  });

  it('keeps nothing below the threshold', () => {
    expect(selectUsedChunks([chunk(1, 0.1), chunk(2, 0.2)], 0.35)).toEqual([]);
  });
});
