// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { redactPii, redactUnknown } from './pii-redaction';

describe('PII redaction', () => {
  it('redacts only selected categories', () => {
    expect(redactPii('Use person@example.com or +1 (555) 123-4567', ['email'])).toBe(
      'Use [REDACTED: EMAIL] or +1 (555) 123-4567',
    );
  });

  it('redacts card numbers only when their checksum is valid', () => {
    expect(redactPii('Card 4111 1111 1111 1111, ref 4111 1111 1111 1112', ['payment_card'])).toBe(
      'Card [REDACTED: PAYMENT CARD], ref 4111 1111 1111 1112',
    );
  });

  it('redacts labeled secrets, bearer values and JWTs', () => {
    const jwt = 'eyJabcdefgh.abcdefgh.abcdefgh';
    expect(redactPii(`password=hunter2 Bearer abc.def api_key:xyz ${jwt}`, ['credentials'])).toBe(
      'password=[REDACTED: CREDENTIAL] Bearer [REDACTED: CREDENTIAL] api_key=[REDACTED: CREDENTIAL] [REDACTED: CREDENTIAL]',
    );
  });

  it('redacts nested provider snapshots without changing non-text values', () => {
    expect(redactUnknown({ body: ['person@example.com', 3], ok: true }, ['email'])).toEqual({
      body: ['[REDACTED: EMAIL]', 3],
      ok: true,
    });
  });
});
