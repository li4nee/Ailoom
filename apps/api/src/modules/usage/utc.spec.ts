// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';

import { utcDay, utcMonthKey, utcMonthStart } from './utc';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('utc keys', () => {
  it('formats a day, month start and month key', () => {
    const at = new Date('2026-01-31T23:59:59Z');
    expect(utcDay(at)).toBe('2026-01-31');
    expect(utcMonthStart(at)).toBe('2026-01-01');
    expect(utcMonthKey(at)).toBe('2026-01');
  });

  it('separates months at the UTC boundary', () => {
    expect(utcMonthKey(new Date('2026-01-31T23:59:59Z'))).toBe('2026-01');
    expect(utcMonthKey(new Date('2026-02-01T00:00:00Z'))).toBe('2026-02');
  });

  it('utcDay ignores the server time zone', () => {
    vi.stubEnv('TZ', 'Pacific/Kiritimati');
    expect(utcDay(new Date('2026-01-31T23:00:00Z'))).toBe('2026-01-31');
  });
});
