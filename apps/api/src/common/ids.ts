// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';

import { newRequestId as newReqId } from './context/request-context';

export { newReqId as newRequestId };

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const UUID7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let lastMs = 0;
let seq = 0;

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

/** UUIDv7 (time-ordered, RFC 9562 layout) — monotonic within a millisecond. */
export function newId(): string {
  const ms = Date.now();
  if (ms === lastMs) {
    seq = (seq + 1) & 0x0fff;
    if (seq === 0) lastMs = ms; // rare overflow: keep same ms, rand_b will differ
  } else {
    seq = (randomBytes(2).readUInt16BE() & 0x0fff) >>> 0;
    lastMs = ms;
  }
  const rand = randomBytes(8);
  const b = Buffer.alloc(16);
  b.writeUIntBE(ms, 0, 6);
  b[6] = 0x70 | ((seq >>> 8) & 0x0f);
  b[7] = seq & 0xff;
  const rand0 = rand[0];
  b[8] = 0x80 | ((rand0 ?? 0) & 0x3f);
  rand.copy(b, 9, 1);
  const hex = b.toString('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!UUID7_RE.test(id)) throw new Error('generated non-v7 uuid');
  return id;
}

export function newPublicKey(): string {
  return `pk_live_${base62(24)}`;
}
