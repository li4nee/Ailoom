// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { v7 as uuidv7 } from 'uuid';

import { type FileStorage, type StoredObject, assertSafeStorageKey } from './file-storage';

/**
 * Blobs on the local filesystem, under `STORAGE_DIR` (spec §12.1). Writes go to a temporary
 * sibling and are renamed into place, so a crash never leaves a truncated file under a real
 * key; the size and SHA-256 are computed while streaming, not by reading the file twice.
 */
export class LocalDiskStorage implements FileStorage {
  private readonly root: string;

  constructor(storageDir: string) {
    this.root = resolve(storageDir);
  }

  async put(key: string, data: Buffer | Readable): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${uuidv7()}.part`;

    const hash = createHash('sha256');
    let sizeBytes = 0;
    const measure = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        sizeBytes += chunk.length;
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Buffer.isBuffer(data) ? Readable.from([data]) : data,
        measure,
        createWriteStream(temp),
      );
      await rename(temp, path);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return { sizeBytes, sha256: hash.digest('hex') };
  }

  async get(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    // Opening lazily would surface ENOENT after the caller already started streaming; fail
    // the promise instead, so a missing blob is a rejected `get`.
    await access(path);
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return access(this.pathFor(key)).then(
      () => true,
      () => false,
    );
  }

  private pathFor(key: string): string {
    assertSafeStorageKey(key);
    const path = resolve(join(this.root, key));
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) {
      throw new Error(`Storage key escapes the storage root: ${JSON.stringify(key)}`);
    }
    return path;
  }
}
