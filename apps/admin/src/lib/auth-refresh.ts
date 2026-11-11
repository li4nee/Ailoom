// SPDX-License-Identifier: AGPL-3.0-only
import { errorFromResponse } from './api-error';

export type RefreshOutcome = 'refreshed' | 'race' | 'failed';

let inFlight: Promise<RefreshOutcome> | null = null;

async function postRefresh(): Promise<RefreshOutcome> {
  const response = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'fetch' },
  });
  if (response.ok) return 'refreshed';
  const error = await errorFromResponse(response);
  // Another tab rotated the cookie moments ago; the browser now holds its new one.
  return error.code === 'refresh_race' ? 'race' : 'failed';
}

/**
 * Single-flight session refresh. Within a tab, concurrent 401s share one request; across tabs,
 * the Web Locks API serializes refreshes so two tabs rarely present the same refresh token
 * (the server answers `refresh_race` when they do, and the caller simply replays).
 */
export function refreshSession(): Promise<RefreshOutcome> {
  inFlight ??= (async () => {
    try {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      return locks === undefined
        ? await postRefresh()
        : await locks.request('auth-refresh', () => postRefresh());
    } catch {
      return 'failed';
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
