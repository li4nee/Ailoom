// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';

/**
 * The fingerprint of a document version (spec §12.2). Ingestion compares it with the stored
 * version's hash: an unchanged page is skipped, not re-embedded. Callers pass normalized
 * content, so whitespace noise does not count as a change.
 */
export function contentHash(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
