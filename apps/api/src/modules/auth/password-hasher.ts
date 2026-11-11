// SPDX-License-Identifier: AGPL-3.0-only
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import type { Options } from '@node-rs/argon2';

/** OWASP baseline for argon2id (spec §10.1): 19 MiB, 2 iterations, 1 lane. */
const ARGON2ID_PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

const ARGON2ID_OPTIONS: Options = { ...ARGON2ID_PARAMS };

/** A hash of an unrelated string with the current parameters, used only to burn the same CPU time as a real verification (unknown emails must not be cheaper to reject). */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$B+4cavwBsYg1Y4Z+p2DRUQ$claIRhox2SjaaAMMKQtl3V2ujFnME6IWAN2t0NLiwdw';

const PHC_PATTERN = /^\$argon2(id|d|i)\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/;

/**
 * Verifies and creates argon2id password hashes. Parsing the PHC string by hand instead of
 * using the library's parser: it rejects truncated fixtures, and a needs-rehash check must
 * answer for any stored hash, not throw on it.
 */
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    return argon2Hash(password, ARGON2ID_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    return argon2Verify(passwordHash, password);
  }

  /** Costs a full verification without ever succeeding; keeps unknown-email logins indistinguishable. */
  async verifyDummy(password: string): Promise<void> {
    await argon2Verify(DUMMY_HASH, password);
  }

  /** True when a stored hash is not argon2id v19 with at least the current parameters. */
  needsRehash(passwordHash: string): boolean {
    const match = PHC_PATTERN.exec(passwordHash);
    if (match === null) return true;
    const [, variant = '', version = '', m = '', t = '', p = ''] = match;
    return (
      variant !== 'id' ||
      version !== '19' ||
      Number(m) < ARGON2ID_PARAMS.memoryCost ||
      Number(t) < ARGON2ID_PARAMS.timeCost ||
      Number(p) !== ARGON2ID_PARAMS.parallelism
    );
  }
}
