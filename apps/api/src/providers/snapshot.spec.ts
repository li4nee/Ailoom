// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { capSnapshot } from './snapshot';

describe('capSnapshot', () => {
  it('keeps small values', () => {
    expect(capSnapshot({ a: 1 })).toEqual({ a: 1 });
  });

  it('truncates large values', () => {
    expect(capSnapshot({ a: 'x'.repeat(70_000) })).toMatchObject({ truncated: true });
  });

  it('reports the byte size and a preview of maxBytes characters', () => {
    const value = { a: 'x'.repeat(100) };
    const json = JSON.stringify(value);
    expect(capSnapshot(value, 10)).toEqual({
      truncated: true,
      bytes: json.length,
      preview: json.slice(0, 10),
    });
  });

  it('measures the limit in utf-8 bytes', () => {
    // JSON `"€€"`: 2 quote bytes + 2 × 3-byte characters = 8 bytes, but 4 characters.
    expect(capSnapshot('€€', 7)).toMatchObject({ truncated: true, bytes: 8 });
    expect(capSnapshot('€€', 8)).toBe('€€');
  });

  it('keeps undefined', () => {
    expect(capSnapshot(undefined)).toBeUndefined();
  });

  it('does not throw on values JSON cannot encode', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(capSnapshot(circular)).toEqual({ unserializable: true });
  });
});
