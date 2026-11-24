// SPDX-License-Identifier: MIT
import { z } from 'zod';

/** One source an AI answer cites (spec §13.6), as stored on the message. */
export const citationSchema = z.object({
  n: z.number().int(),
  chunkId: z.string(),
  documentId: z.string(),
  title: z.string(),
  url: z.string().nullable(),
});

export type Citation = z.infer<typeof citationSchema>;

export interface ParsedCitations {
  text: string;
  citations: Citation[];
}

/** Fenced blocks and inline code spans; their contents are never treated as citations. */
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/g;
// The lookbehind starts a match only at the beginning of a whitespace run, keeping it linear.
const MARKER = /(?<![ \t])([ \t]*)\[([^\]\n]*)\]/g;
const MARKER_CONTENT = /^\d+(?:\s*,\s*\d+)*$/;

/** Strips unsupported source markers and returns only citations backed by retrieved sources. */
export function parseCitations(text: string, used: Citation[]): ParsedCitations {
  const byNumber = new Map(used.map((citation) => [citation.n, citation]));
  const cited = new Map<number, Citation>();
  const rewritten = text.split(CODE).map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(MARKER, (_match, leading: string, inner: string) => {
      if (!MARKER_CONTENT.test(inner.trim())) return _match;
      const numbers = inner
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((number) => byNumber.has(number));
      if (numbers.length === 0) return '';
      for (const number of numbers) {
        const citation = byNumber.get(number);
        if (citation !== undefined && !cited.has(number)) cited.set(number, citation);
      }
      return `${leading}${numbers.map((number) => `[${String(number)}]`).join('')}`;
    });
  });
  return { text: rewritten.join(''), citations: [...cited.values()] };
}
