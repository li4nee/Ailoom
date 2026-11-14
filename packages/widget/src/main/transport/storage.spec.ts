// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from 'vitest';

import { tokenKey, tokenStore, type StorageLike } from './storage';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
  if (original === undefined) {
    Reflect.deleteProperty(globalThis, 'localStorage');
  } else {
    Object.defineProperty(globalThis, 'localStorage', original);
  }
});

describe('tokenStore', () => {
  it('namespaces the key by bot', () => {
    const keys: string[] = [];
    const storage: StorageLike = {
      getItem: () => null,
      setItem: (key) => {
        keys.push(key);
      },
      removeItem: () => undefined,
    };

    tokenStore('pk_live_x', storage).set('token');

    expect(keys).toEqual([tokenKey('pk_live_x')]);
    expect(tokenKey('pk_live_x')).toBe('ailoom:pk_live_x:token');
  });

  it('falls back to memory when storage reads and writes throw', () => {
    const blocked: StorageLike = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    const store = tokenStore('pk_live_x', blocked);

    store.set('visitor-token');
    expect(store.get()).toBe('visitor-token');

    store.clear();
    expect(store.get()).toBeNull();
  });

  it('works when accessing localStorage itself throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });

    const store = tokenStore('pk_live_x');
    store.set('in-memory');
    expect(store.get()).toBe('in-memory');
  });
});
