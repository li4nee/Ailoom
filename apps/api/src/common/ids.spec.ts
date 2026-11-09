// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { newId, newPublicKey } from './ids';

describe('ids', () => {
  it('newId is v7 and sortable', () => {
    const a = newId();
    const b = newId();
    expect(a[14]).toBe('7');
    expect(a < b).toBe(true);
  });

  it('newId has the RFC 9562 version 7 layout', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('newId is strictly increasing across 10,000 ids generated in a tight loop', () => {
    let previous = newId();
    for (let i = 0; i < 10_000; i += 1) {
      const next = newId();
      expect(next > previous, `id ${String(i)}: ${next} is not after ${previous}`).toBe(true);
      previous = next;
    }
  });

  it('public keys look right', () => {
    expect(newPublicKey()).toMatch(/^pk_live_[0-9A-Za-z]{24}$/);
  });
});
