// SPDX-License-Identifier: AGPL-3.0-only
import { decode, encode } from 'gpt-tokenizer';

/**
 * Tokens as the embedding models count them. Every provider in the catalog uses a
 * cl100k-family tokenizer, close enough that one count serves as the budget for all of them
 * (spec §12.4).
 */
export function countTokens(text: string): number {
  if (text === '') return 0;
  return encode(text).length;
}

/** Cuts `text` into pieces of at most `maxTokens` tokens, for a sentence that has no end. */
export function splitByTokens(text: string, maxTokens: number): string[] {
  const tokens = encode(text);
  const pieces: string[] = [];
  for (let start = 0; start < tokens.length; start += maxTokens) {
    pieces.push(decode(tokens.slice(start, start + maxTokens)));
  }
  return pieces;
}
