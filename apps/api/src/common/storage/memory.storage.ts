// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { type FileStorage, type StoredObject, assertSafeStorageKey } from './file-storage';

/** Blobs in a `Map`: unit tests and an in-memory app boot need no filesystem. */
export class MemoryStorage implements FileStorage {
  readonly blobs = new Map<string, Buffer>();

  async put(key: string, data: Buffer | Readable): Promise<StoredObject> {
    assertSafeStorageKey(key);
    const buffer = Buffer.isBuffer(data) ? data : await bufferOf(data);
    this.blobs.set(key, buffer);
    return {
      sizeBytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  get(key: string): Promise<Readable> {
    assertSafeStorageKey(key);
    const blob = this.blobs.get(key);
    if (blob === undefined) return Promise.reject(new Error(`No blob at ${key}`));
    return Promise.resolve(Readable.from([blob]));
  }

  delete(key: string): Promise<void> {
    assertSafeStorageKey(key);
    this.blobs.delete(key);
    return Promise.resolve();
  }

  exists(key: string): Promise<boolean> {
    assertSafeStorageKey(key);
    return Promise.resolve(this.blobs.has(key));
  }
}

async function bufferOf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}
