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

  it('public keys look right', () => {
    expect(newPublicKey()).toMatch(/^pk_live_[0-9A-Za-z]{24}$/);
  });
});
