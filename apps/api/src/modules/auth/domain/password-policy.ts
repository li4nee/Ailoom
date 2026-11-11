// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PASSWORD_MAX, PASSWORD_MIN } from '@app/shared';

/** Why a password is not acceptable. Reported to the client as validation details. */
export type PasswordProblem = 'too_short' | 'too_long' | 'too_common' | 'contains_email';

/** Email local parts shorter than this never trip `contains_email` (too many false positives). */
const MIN_LOCAL_PART_LENGTH = 4;

// The wordlist is a build-time constant shipped with the app (SecLists top 10,000, MIT),
// so loading it once at module init does not make `checkPassword` impure: it reads no
// request data, no env and no clock.
const COMMON_PASSWORDS: ReadonlySet<string> = loadCommonPasswords();

function loadCommonPasswords(): ReadonlySet<string> {
  const file = readFileSync(join(__dirname, 'common-passwords.txt'), 'utf8');
  return new Set(
    file
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0),
  );
}

/** Every reason `password` fails the policy, in reporting order; empty when it passes. */
export function checkPassword(password: string, ctx: { email: string }): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_MIN) problems.push('too_short');
  if (password.length > PASSWORD_MAX) problems.push('too_long');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) problems.push('too_common');
  const localPart = ctx.email.trim().toLowerCase().split('@')[0] ?? '';
  if (localPart.length >= MIN_LOCAL_PART_LENGTH && password.toLowerCase().includes(localPart)) {
    problems.push('contains_email');
  }
  return problems;
}
