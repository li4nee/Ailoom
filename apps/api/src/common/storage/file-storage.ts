// SPDX-License-Identifier: AGPL-3.0-only
import type { Readable } from 'node:stream';

import { v7 as uuidv7 } from 'uuid';

/** Injected everywhere a blob is written: knowledge files now, exports in a later milestone. */
export const FILE_STORAGE = Symbol('FILE_STORAGE');

export interface StoredObject {
  sizeBytes: number;
  sha256: string;
}

/**
 * Blobs live outside Postgres, under an opaque key; the `files` row keeps the metadata. A
 * missing key is not an error for `delete`: a purge retries and must stay idempotent.
 */
export interface FileStorage {
  put(key: string, data: Buffer | Readable): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const SAFE_KEY = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * `<workspaceId>/<uuidv7>`: the workspace prefix lets a purge find a workspace's blobs, and
 * nothing user-supplied ends up in the path. Time-ordered ids keep a directory readable.
 * `common` is a leaf and cannot import `db`'s branded id, so the id is typed as a string.
 */
export function newStorageKey(workspaceId: string): string {
  return `${workspaceId}/${uuidv7()}`;
}

/**
 * Rejects a key that could escape the storage root (`..`, an absolute path, a backslash, a
 * NUL byte). Every implementation calls this before touching the filesystem.
 */
export function assertSafeStorageKey(key: string): void {
  const segments = key.split('/');
  if (!SAFE_KEY.test(key) || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
  }
}

/** The workspace a key belongs to; the first segment by construction. */
export function workspaceOfKey(key: string): string {
  const [workspaceId] = key.split('/');
  return workspaceId ?? '';
}
