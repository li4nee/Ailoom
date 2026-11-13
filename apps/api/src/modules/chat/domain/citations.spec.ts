// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { Citation } from '@app/shared';

import { parseCitations } from './citations';

const c1: Citation = {
  n: 1,
  chunkId: 'chunk-1',
  documentId: 'doc-1',
  title: 'Refunds',
  url: 'https://shop.example/refunds',
};
const c2: Citation = {
  n: 2,
  chunkId: 'chunk-2',
  documentId: 'doc-2',
  title: 'Shipping',
  url: null,
};
const c3: Citation = {
  n: 3,
  chunkId: 'chunk-3',
  documentId: 'doc-3',
  title: 'Warranty',
  url: null,
};

const used2 = [c1, c2];

describe('parseCitations', () => {
  it('keeps valid and strips invalid markers', () => {
    expect(parseCitations('A [1]. B [7]. C [2,1].', used2)).toEqual({
      text: 'A [1]. B. C [2][1].',
      citations: [c1, c2],
    });
  });

  it('ignores numbers in code spans', () => {
    expect(parseCitations('use `arr[1]` [1]', used2).citations).toEqual([c1]);
    expect(parseCitations('```\nx[1]\n```\nSee [1].', used2).text).toBe('```\nx[1]\n```\nSee [1].');
  });

  it('handles [ 3 ] spacing and leaves footnote-style [^1] untouched', () => {
    expect(parseCitations('[ 3 ] and [^1]', [c3])).toEqual({
      text: '[3] and [^1]',
      citations: [c3],
    });
  });

  it('handles [n][m] markers and deduplicates citations', () => {
    expect(parseCitations('[1][2] and [1] again', used2)).toEqual({
      text: '[1][2] and [1] again',
      citations: [c1, c2],
    });
  });

  it('strips every marker when nothing was used', () => {
    expect(parseCitations('A [1]. B [2].', [])).toEqual({ text: 'A. B.', citations: [] });
  });

  it('leaves non-numeric brackets untouched', () => {
    expect(parseCitations('an [array] and [a, b]', used2)).toEqual({
      text: 'an [array] and [a, b]',
      citations: [],
    });
  });
});
