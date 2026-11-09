// SPDX-License-Identifier: AGPL-3.0-only
import { AppError } from '../common/errors';
import { isUuid } from './ids';

/** Opaque to clients; the UUIDv7 id is only base64url-wrapped to make tampering less tempting. */
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!isUuid(id)) throw new AppError('validation_failed', { cause: cursor });
  return id;
}
