// SPDX-License-Identifier: AGPL-3.0-only

/** A latest message shorter than this is treated as a follow-up (spec §13.2). */
export const FOLLOW_UP_MAX_WORDS = 5;

function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '').length;
}

/**
 * The text embedded for retrieval (spec §13.2, Phase 1): the latest visitor message, joined to
 * the previous one when the latest is shorter than six words ("and for annual plans?").
 * `visitorMessages` is chronological, latest last.
 */
export function buildRetrievalQuery(visitorMessages: string[]): string {
  const latest = visitorMessages.at(-1);
  if (latest === undefined) {
    throw new Error('buildRetrievalQuery needs at least one visitor message');
  }
  if (wordCount(latest) > FOLLOW_UP_MAX_WORDS) return latest;

  const previous = visitorMessages.at(-2);
  return previous === undefined ? latest : `${previous}\n${latest}`;
}
