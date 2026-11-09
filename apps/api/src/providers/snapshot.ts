// SPDX-License-Identifier: AGPL-3.0-only

/** Upper bound on a stored provider request snapshot (spec §11.3: 64 KB). */
export const SNAPSHOT_MAX_BYTES = 65_536;

/**
 * Returns `value` unchanged when its JSON fits in `maxBytes` (UTF-8), otherwise a truncation
 * marker with the full size and the first `maxBytes` characters of the JSON.
 */
export function capSnapshot(value: unknown, maxBytes = SNAPSHOT_MAX_BYTES): unknown {
  let json: unknown;
  try {
    // `undefined`, functions and symbols have no JSON form; the typings omit that case.
    json = JSON.stringify(value);
  } catch {
    // Circular structures and BigInts: the snapshot is diagnostic, never worth a failed call.
    return { unserializable: true };
  }
  if (typeof json !== 'string') return value;
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= maxBytes) return value;
  return { truncated: true, bytes, preview: json.slice(0, maxBytes) };
}
