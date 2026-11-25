// SPDX-License-Identifier: AGPL-3.0-only
import { structuredPatch } from 'diff';

import type { VersionDiffDto } from '@app/shared';

const DEFAULT_MAX_OUTPUT_BYTES = 200_000;

/** Build a three-line-context LCS diff and cap its text payload to a bounded byte size. */
export function diffVersions(
  oldText: string,
  newText: string,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
): VersionDiffDto {
  const patch = structuredPatch('old', 'new', oldText, newText, undefined, undefined, {
    context: 3,
  });
  let remaining = Math.max(0, maxOutputBytes - 64);
  let truncated = false;
  const hunks: VersionDiffDto['hunks'] = [];
  for (const hunk of patch.hunks) {
    const lines: VersionDiffDto['hunks'][number]['lines'] = [];
    for (const line of hunk.lines) {
      const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : 'context';
      const text = line.slice(1);
      const cost = Buffer.byteLength(JSON.stringify({ kind, text }), 'utf8') + 1;
      if (cost > remaining) {
        truncated = true;
        break;
      }
      remaining -= cost;
      lines.push({ kind, text });
    }
    if (lines.length > 0)
      hunks.push({
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines,
      });
    if (truncated) break;
  }
  if (!truncated && hunks.length < patch.hunks.length) truncated = true;
  while (Buffer.byteLength(JSON.stringify({ hunks, truncated }), 'utf8') > maxOutputBytes) {
    truncated = true;
    const last = hunks.at(-1);
    if (last === undefined) break;
    last.lines.pop();
    if (last.lines.length === 0) hunks.pop();
  }
  return { hunks, truncated };
}
