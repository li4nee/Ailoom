// SPDX-License-Identifier: AGPL-3.0-only
import { ApiError, errorFromResponse } from './api-error';

/**
 * `rejected`: the server refused the refresh token (401), so the session is really over.
 * `unavailable`: the refresh could not be answered (network, 5xx, 429). The session may well
 * be fine, so the caller must not sign the user out; `error` says what went wrong.
 */
export type RefreshOutcome =
  | { kind: 'refreshed' }
  | { kind: 'race' }
  | { kind: 'rejected' }
  | { kind: 'unavailable'; error: ApiError };

let inFlight: Promise<RefreshOutcome> | null = null;

async function postRefresh(): Promise<RefreshOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'fetch' },
    });
  } catch {
    return {
      kind: 'unavailable',
      error: new ApiError({ code: 'internal_error', status: 0, message: 'Network error' }),
    };
  }
  if (response.ok) return { kind: 'refreshed' };
  const error = await errorFromResponse(response);
  // Another tab rotated the cookie moments ago; the browser now holds its new one.
  if (error.code === 'refresh_race') return { kind: 'race' };
  return response.status === 401 ? { kind: 'rejected' } : { kind: 'unavailable', error };
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
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
