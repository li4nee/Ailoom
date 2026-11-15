// SPDX-License-Identifier: MIT

/** The visitor token key namespaced by bot (spec §10.4): `ailoom:<publicKey>:token`. */
export function tokenKey(publicKey: string): string {
  return `ailoom:${publicKey}:token`;
}

export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

/** The slice of `Storage` the store uses; a test can pass a throwing object. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * `localStorage` throws on mere access in Safari private mode and inside a partitioned iframe,
 * so it is resolved defensively. Every failure falls back to an in-memory token, which keeps
 * the widget working for the page lifetime (spec §16.3).
 */
function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function tokenStore(
  publicKey: string,
  storage: StorageLike | null = browserStorage(),
): TokenStore {
  const key = tokenKey(publicKey);
  let memory: string | null = null;

  return {
    get() {
      if (storage !== null) {
        try {
          return storage.getItem(key);
        } catch {
          // Blocked storage: keep using the in-memory copy.
        }
      }
      return memory;
    },
    set(token) {
      memory = token;
      if (storage === null) return;
      try {
        storage.setItem(key, token);
      } catch {
        // Quota or blocked storage: the in-memory copy still works for this page.
      }
    },
    clear() {
      memory = null;
      if (storage === null) return;
      try {
        storage.removeItem(key);
      } catch {
        // Nothing else to clear.
      }
    },
  };
}
