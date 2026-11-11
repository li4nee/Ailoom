// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { PasswordHasher } from './password-hasher';

const hasher = new PasswordHasher();

describe('PasswordHasher', () => {
  it('hashes with argon2id OWASP params', async () => {
    expect(await hasher.hash('correct horse battery')).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
  });

  it('verifies', async () => {
    const h = await hasher.hash('a'.repeat(12));
    expect(await hasher.verify(h, 'a'.repeat(12))).toBe(true);
    expect(await hasher.verify(h, 'b'.repeat(12))).toBe(false);
  });

  it('flags weaker hashes for rehash', () => {
    expect(hasher.needsRehash('$argon2id$v=19$m=4096,t=3,p=1$c2FsdA$aGFzaA')).toBe(true);
  });

  it('accepts current-parameter hashes for rehash', async () => {
    expect(hasher.needsRehash(await hasher.hash('correct horse battery'))).toBe(false);
  });

  it('flags hashes of other argon2 variants for rehash', () => {
    expect(hasher.needsRehash('$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA')).toBe(true);
  });

  it('verifyDummy always resolves without matching a real password', async () => {
    await expect(hasher.verifyDummy('anything')).resolves.toBeUndefined();
  });
});
