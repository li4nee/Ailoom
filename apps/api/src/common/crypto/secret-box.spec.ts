// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SecretBox } from './secret-box';

const k1 = { version: 1, key: randomBytes(32) };
const k2 = { version: 2, key: randomBytes(32) };

describe('SecretBox', () => {
  it('round-trips', () => {
    const b = new SecretBox([k1]);
    expect(b.open(b.seal('sk-123'))).toBe('sk-123');
  });

  it('uses a fresh 12-byte iv each time', () => {
    const b = new SecretBox([k1]);
    const a = b.seal('x');
    const c = b.seal('x');
    expect(a.iv).toHaveLength(12);
    expect(a.iv.equals(c.iv)).toBe(false);
  });

  it('decrypts with older keys and encrypts with the first', () => {
    const old = new SecretBox([k1]).seal('s');
    const ring = new SecretBox([k2, k1]);
    expect(ring.open(old)).toBe('s');
    expect(ring.seal('s').keyVersion).toBe(2);
    expect(ring.needsReencrypt(old)).toBe(true);
  });

  it('detects tampering', () => {
    const b = new SecretBox([k1]);
    const s = b.seal('x');
    s.ciphertext[0] ^= 1;
    expect(() => b.open(s)).toThrow();
  });

  it('fails clearly for an unknown key version', () => {
    expect(() => new SecretBox([k2]).open(new SecretBox([k1]).seal('x'))).toThrow(/key version 1/);
  });
});
