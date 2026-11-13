// SPDX-License-Identifier: AGPL-3.0-only
import type { Citation } from '@app/shared';

export type { Citation };

export interface ParsedCitations {
  text: string;
  citations: Citation[];
}

/** Fenced blocks and inline code spans; their contents are never treated as citations. */
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/g;

/** A bracketed marker with the whitespace before it, so a stripped marker leaves tidy text. */
const MARKER = /([ \t]*)\[([^\]\n]*)\]/g;

const MARKER_CONTENT = /^\d+(?:\s*,\s*\d+)*$/;

/**
 * Spec §13.6: maps `[n]` markers to the sources actually used. Accepts `[n]`, `[n, m]`,
 * `[n][m]` and `[ n ]`; rewrites a multi-number marker to one marker per number; strips any
 * marker whose number is not in `used` (with the whitespace before it); leaves everything else,
 * including footnote-style `[^1]` and numbers inside code, untouched. `citations` holds the
 * cited sources in first-appearance order, deduplicated.
 */
export function parseCitations(text: string, used: Citation[]): ParsedCitations {
  const byNumber = new Map(used.map((citation) => [citation.n, citation]));
  const cited = new Map<number, Citation>();

  const parts = text.split(CODE);
  const rewritten = parts.map((part, index) => {
    // Odd indexes are the captured code segments, which pass through verbatim.
    if (index % 2 === 1) return part;
    return part.replace(MARKER, (_match, leading: string, inner: string) => {
      if (!MARKER_CONTENT.test(inner.trim())) return _match;

      const numbers = inner
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((n) => byNumber.has(n));

      if (numbers.length === 0) return '';

      for (const n of numbers) {
        if (!cited.has(n)) {
          const citation = byNumber.get(n);
          if (citation !== undefined) cited.set(n, citation);
        }
      }
      return `${leading}${numbers.map((n) => `[${String(n)}]`).join('')}`;
    });
  });

  return { text: rewritten.join(''), citations: [...cited.values()] };
}
