// SPDX-License-Identifier: AGPL-3.0-only
import { strings } from '@/strings';

/**
 * Canonical form of an allowed origin, or the message the API would answer with. The API
 * normalizes again and stays the authority; this only spares an operator a round trip, so the
 * two messages are the same text on purpose (spec §9.2, Task 2.7).
 */
export function normalizeOrigin(pattern: string): { value: string } | { error: string } {
  const trimmed = pattern.trim();
  if (trimmed === '*') return { error: strings.bots.originsSubdomainHint };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: strings.bots.originsInvalid };
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    (url.hostname.includes('*') && !url.hostname.startsWith('*.')) ||
    url.hostname === '*'
  ) {
    return { error: strings.bots.originsSubdomainHint };
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return { error: strings.bots.originsPath };
  }
  return { value: `${url.protocol}//${url.host}` };
}

/** Every line, normalized; the first bad line stops the save with its message. */
export function normalizeOrigins(lines: string[]): { values: string[] } | { error: string } {
  const values: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const result = normalizeOrigin(line);
    if ('error' in result) return result;
    values.push(result.value);
  }
  return { values };
}
