// SPDX-License-Identifier: AGPL-3.0-only

export const REWRITE_CONTEXT_MESSAGE_MAX = 600;
export const REWRITE_CONTEXT_TOTAL_MAX = 1_000;
export const REWRITTEN_QUERY_MAX = 500;

export function shouldRewriteQuery(visitorMessages: readonly string[]): boolean {
  if (visitorMessages.length < 2) return false;
  const latest = visitorMessages.at(-1)?.trim() ?? '';
  const words = latest.split(/\s+/).filter(Boolean).length;
  return (
    words <= 8 ||
    /\b(it|that|those|they|them|this|same|also|and for|what about|how about|what if)\b/i.test(
      latest,
    )
  );
}

/** Scrub common direct identifiers before conversation text is sent to the rewrite model. */
export function redactRewriteContext(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[redacted number]')
    .replace(/(?:\+?\d[\d(). -]{7,}\d)/g, '[redacted phone]');
}

/** Only the latest two visitor messages are eligible; assistant, agent, and tool text never is. */
export function buildRewriteContext(visitorMessages: readonly string[]): string[] {
  const selected = visitorMessages
    .slice(-2)
    .map((message) => redactRewriteContext(message.slice(-REWRITE_CONTEXT_MESSAGE_MAX)));
  let budget = REWRITE_CONTEXT_TOTAL_MAX;
  const bounded: string[] = [];
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const message = selected[index];
    if (message === undefined || budget <= 0) continue;
    const kept = message.slice(-budget);
    bounded.unshift(kept);
    budget -= kept.length;
  }
  return bounded;
}

/** Accept a single short plain-text search query; reject instructions, dumps, and empty output. */
export function parseRewrittenQuery(output: string): string | null {
  const query = output.trim();
  if (
    query.length === 0 ||
    query.length > REWRITTEN_QUERY_MAX ||
    /[\r\n]/.test(query) ||
    query.startsWith('```') ||
    query.startsWith('{') ||
    query.startsWith('[')
  ) {
    return null;
  }
  return query;
}
