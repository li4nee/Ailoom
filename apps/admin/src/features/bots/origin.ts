// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeOrigin } from '@app/shared';

/**
 * Every line, normalized with the API's own rule; the first bad line stops the save with the
 * message the API would answer with. The API normalizes again and stays the authority.
 */
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
