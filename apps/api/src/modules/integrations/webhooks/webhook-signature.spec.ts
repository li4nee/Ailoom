// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { signWebhook, verifyWebhookSignature } from './webhook-signature';

describe('webhook signatures', () => {
  it('signs and verifies the timestamp/body envelope', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const timestamp = String(Math.floor(now / 1000));
    const signature = signWebhook(timestamp, '{"id":"event-1"}', 'whsec_test');

    expect(
      verifyWebhookSignature(timestamp, '{"id":"event-1"}', 'whsec_test', signature, now),
    ).toBe(true);
    expect(
      verifyWebhookSignature(timestamp, '{"id":"event-2"}', 'whsec_test', signature, now),
    ).toBe(false);
  });

  it('rejects stale timestamps and another secret', () => {
    const now = Date.parse('2026-01-01T00:10:00Z');
    const timestamp = String(Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000));
    const signature = signWebhook(timestamp, '{}', 'whsec_test');

    expect(verifyWebhookSignature(timestamp, '{}', 'whsec_test', signature, now)).toBe(false);
    expect(verifyWebhookSignature(timestamp, '{}', 'whsec_other', signature, now)).toBe(false);
  });
});
