// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { checkPassword } from './password-policy';

describe('checkPassword', () => {
  it.each([
    ['short', ['too_short']],
    ['x'.repeat(129), ['too_long']],
    ['password123', ['too_common']],
    ['alice-secret-pass', ['contains_email']],
    ['correct horse battery', []],
  ])('%s → %j', (pw, problems) => {
    expect(checkPassword(pw, { email: 'alice@example.com' })).toEqual(problems);
  });

  it('checks common passwords case-insensitively', () => {
    expect(checkPassword('PassWord123', { email: 'a@b.c' })).toContain('too_common');
  });

  it('flags a password containing a long email local part', () => {
    expect(checkPassword('hunter2-is-my-kevin', { email: 'kevin@example.com' })).toContain(
      'contains_email',
    );
  });

  it('ignores short email local parts', () => {
    expect(checkPassword('jo-is-my-password', { email: 'jo@example.com' })).not.toContain(
      'contains_email',
    );
  });
});
