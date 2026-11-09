// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';

import { v7 as uuidv7 } from 'uuid';

import { newRequestId as newReqId } from './context/request-context';

export { newReqId as newRequestId };

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function base62(n: number): string {
  let body = '';
  while (body.length < n) {
    for (const byte of randomBytes(n)) {
      if (byte < 248) body += ALPHABET.charAt(byte % ALPHABET.length);
      if (body.length === n) break;
    }
  }
  return body;
}

/**
 * UUIDv7 (time-ordered, RFC 9562): strictly increasing within one process, also inside a
 * single millisecond, because the `uuid` package carries a sequence counter between calls.
 */
export function newId(): string {
  return uuidv7();
}

export function newPublicKey(): string {
  return `pk_live_${base62(24)}`;
}
