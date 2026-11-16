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
    const first = s.ciphertext[0];
    if (first === undefined) throw new Error('empty ciphertext');
    s.ciphertext[0] = first ^ 1;
    expect(() => b.open(s)).toThrow();
  });

  it('rejects an iv of the wrong length before decrypting', () => {
    const b = new SecretBox([k1]);
    const s = b.seal('x');
    s.iv = randomBytes(8);
    expect(() => b.open(s)).toThrow(/invalid iv/);
  });

  it('fails clearly for an unknown key version', () => {
    expect(() => new SecretBox([k2]).open(new SecretBox([k1]).seal('x'))).toThrow(/key version 1/);
  });

  describe('constructor validation', () => {
    it('rejects an empty key list', () => {
      expect(() => new SecretBox([])).toThrow(/at least one encryption key/);
    });

    it.each([0, 16, 31, 33, 64])('rejects a %i-byte key', (length) => {
      expect(() => new SecretBox([{ version: 7, key: randomBytes(length) }])).toThrow(
        /key version 7 must be 32 bytes/,
      );
    });

    it('never puts key material in the error', () => {
      const key = randomBytes(31);
      let message = '';
      try {
        new SecretBox([{ version: 1, key }]);
      } catch (error) {
        message = String(error);
      }
      expect(message).toMatch(/key version 1 must be 32 bytes/);
      expect(message).not.toContain(key.toString('hex'));
      expect(message).not.toContain(key.toString('base64'));
    });

    it('rejects a bad key anywhere in the list, not only the first', () => {
      expect(() => new SecretBox([k2, { version: 1, key: randomBytes(31) }])).toThrow(
        /key version 1 must be 32 bytes/,
      );
    });

    it('rejects two keys with the same version, even when the keys differ', () => {
      expect(() => new SecretBox([k1, { version: k1.version, key: randomBytes(32) }])).toThrow(
        /key version 1 is listed more than once/,
      );
    });

    it('accepts several distinct 32-byte keys', () => {
      expect(() => new SecretBox([k2, k1])).not.toThrow();
    });
  });
});
