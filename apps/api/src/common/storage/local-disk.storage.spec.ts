// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newStorageKey, workspaceOfKey } from './file-storage';
import { LocalDiskStorage } from './local-disk.storage';

let dir: string;
let storage: LocalDiskStorage;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ailoom-storage-'));
  storage = new LocalDiskStorage(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('LocalDiskStorage', () => {
  it.each(['../etc/passwd', '/etc/passwd', 'a/../../b', 'a\\..\\b', 'a/./b', ''])(
    'rejects the unsafe key %j',
    async (key) => {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow(/storage key/i);
      await expect(storage.get(key)).rejects.toThrow(/storage key/i);
      await expect(storage.delete(key)).rejects.toThrow(/storage key/i);
      await expect(storage.exists(key)).rejects.toThrow(/storage key/i);
    },
  );

  it('round-trips and reports sha256', async () => {
    const body = Buffer.from('refund policy\n');
    const key = '00000000-0000-7000-8000-000000000001/00000000-0000-7000-8000-000000000002';

    const stored = await storage.put(key, body);

    expect(stored).toEqual({
      sizeBytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    });
    expect(await storage.exists(key)).toBe(true);
    const stream = await storage.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(chunks).toString()).toBe(body.toString());

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.get(key)).rejects.toThrow();
  });

  it('accepts a stream and counts the bytes it actually wrote', async () => {
    const parts = ['a'.repeat(1024), 'b'.repeat(10)];
    const stored = await storage.put('ws/key', Readable.from(parts.map((p) => Buffer.from(p))));

    expect(stored.sizeBytes).toBe(1034);
  });

  it('leaves no file behind when the source stream fails', async () => {
    const failing = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('network gone'));
      },
    });

    await expect(storage.put('ws/key', failing)).rejects.toThrow('network gone');
    expect(await readdir(join(dir, 'ws'))).toEqual([]);
  });

  it('delete of a missing key is a no-op', async () => {
    await expect(storage.delete('ws/missing')).resolves.toBeUndefined();
  });
});

describe('newStorageKey', () => {
  it('prefixes the workspace and uses a uuid, so a key carries no user input', () => {
    const workspaceId = '00000000-0000-7000-8000-000000000001';
    const key = newStorageKey(workspaceId);

    expect(key).toMatch(
      /^00000000-0000-7000-8000-000000000001\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(workspaceOfKey(key)).toBe(workspaceId);
    expect(newStorageKey(workspaceId)).not.toBe(key);
  });
});
