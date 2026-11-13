// SPDX-License-Identifier: AGPL-3.0-only

/** Built-in handoff phrases (spec §14.1): multi-word intents, never single words. */
export const DEFAULT_HANDOFF_PHRASES = [
  'talk to a human',
  'speak to a person',
  'real person',
  'human agent',
  'talk to someone',
  'customer service',
  'live agent',
  'speak to support',
] as const;

/** A message longer than this is a question, not a handoff request (spec §14.1). */
export const HANDOFF_INTENT_MAX_WORDS = 12;

/**
 * Case- and punctuation-insensitive form used for whole-word matching: NFKC, lowercased,
 * every non-letter/non-number becomes a space, runs collapsed.
 */
export function normalizeForIntent(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * True when `message` is a short request to talk to a person (spec §14.1). Matching is a
 * whole-word sequence match over the normalized text, so "human-readable" never matches
 * "human agent" and a single word never matches. `null` uses the built-in phrases; an empty
 * list matches nothing.
 */
export function detectHandoffIntent(message: string, phrases: string[] | null): boolean {
  const normalized = normalizeForIntent(message);
  if (normalized === '') return false;
  if (normalized.split(' ').length > HANDOFF_INTENT_MAX_WORDS) return false;

  const padded = ` ${normalized} `;
  for (const phrase of phrases ?? DEFAULT_HANDOFF_PHRASES) {
    const needle = normalizeForIntent(phrase);
    if (needle === '') continue;
    if (padded.includes(` ${needle} `)) return true;
  }
  return false;
}
