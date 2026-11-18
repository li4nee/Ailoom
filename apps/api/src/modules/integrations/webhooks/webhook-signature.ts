// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac } from 'node:crypto';

import { timingSafeEqualStr } from '../../../common/crypto';

export function signWebhook(timestamp: string, rawBody: string, secret: string): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  return `sha256=${digest}`;
}

export function verifyWebhookSignature(
  timestamp: string,
  rawBody: string,
  secret: string,
  signature: string,
  now = Date.now(),
  toleranceMs = 5 * 60_000,
): boolean {
  const parsed = Number(timestamp);
  if (!Number.isSafeInteger(parsed) || Math.abs(now - parsed * 1000) > toleranceMs) return false;
  return timingSafeEqualStr(signWebhook(timestamp, rawBody, secret), signature);
}
