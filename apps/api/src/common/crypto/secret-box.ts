// SPDX-License-Identifier: AGPL-3.0-only
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
}

interface KeyEntry {
  version: number;
  key: Buffer;
}

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class SecretBox {
  private readonly byVersion = new Map<number, Buffer>();
  private readonly encryptKey: KeyEntry;

  constructor(keys: KeyEntry[]) {
    if (keys.length === 0) throw new Error('at least one encryption key is required');
    const first = keys[0];
    if (!first) throw new Error('at least one encryption key is required');
    this.encryptKey = first;
    for (const { version, key } of keys) {
      // Messages carry the version only: never any part of the key.
      if (key.length !== KEY_BYTES) {
        throw new Error(
          `Encryption key version ${String(version)} must be ${String(KEY_BYTES)} bytes, got ${String(key.length)}`,
        );
      }
      if (this.byVersion.has(version)) {
        throw new Error(`Encryption key version ${String(version)} is listed more than once`);
      }
      this.byVersion.set(version, key);
    }
  }

  seal(plain: string): Sealed {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.encryptKey.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { ciphertext, iv, tag: cipher.getAuthTag(), keyVersion: this.encryptKey.version };
  }

  open(sealed: Sealed): string {
    const key = this.byVersion.get(sealed.keyVersion);
    if (!key)
      throw new Error(`Encryption key version ${String(sealed.keyVersion)} is not configured`);
    if (sealed.tag.length !== TAG_BYTES) throw new Error('invalid auth tag');
    const decipher = createDecipheriv(ALGO, key, sealed.iv);
    decipher.setAuthTag(sealed.tag);
    return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
  }

  needsReencrypt(sealed: Sealed): boolean {
    return sealed.keyVersion !== this.encryptKey.version;
  }
}
