// SPDX-License-Identifier: AGPL-3.0-only
import type { z } from 'zod';

import { ApiError, errorFromResponse } from './api-error';
import { refreshSession } from './auth-refresh';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ApiOptions<T> {
  method?: HttpMethod;
  body?: unknown;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
  /**
   * Either way an expired session is refreshed once and the request replayed. `required`
   * (default): if the refresh fails, the user is sent to the login page. `optional`: the 401
   * is just returned as an error, for calls public pages make (e.g. "am I signed in?").
   */
  session?: 'required' | 'optional';
}

interface ClientSettings {
  onSessionLost: (next: string) => void;
  /** How long to wait before replaying after another tab won a refresh race. */
  raceDelayMs: number;
}

const settings: ClientSettings = {
  onSessionLost: (next) => {
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  },
  raceDelayMs: 300,
};

/** The router installs its own navigation here at startup; tests install a spy. */
export function configureApiClient(overrides: Partial<ClientSettings>): void {
  Object.assign(settings, overrides);
}

/**
 * 401s that a refresh may cure. `session_revoked` (logout everywhere, password change on
 * another device) is included so that the failing refresh ends in the login redirect.
 */
const REFRESHABLE = new Set(['token_expired', 'unauthorized', 'session_revoked']);

function send(path: string, opts: ApiOptions<unknown>): Promise<Response> {
  const headers: Record<string, string> = { 'X-Requested-With': 'fetch' };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  return fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    headers,
    ...(body === undefined ? {} : { body }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });
}

async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const text = await response.text();
  const data: unknown = text === '' ? undefined : JSON.parse(text);
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError({
      code: 'internal_error',
      status: response.status,
      message: 'Unexpected response shape',
      requestId: response.headers.get('X-Request-Id') ?? '',
    });
  }
  return parsed.data;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The only way the admin talks to the API. Responses are validated with the shared Zod
 * schema; failures become `ApiError`. An expired access token is refreshed silently and the
 * original request replayed once with the same body, so a long-open form is never lost.
 */
export async function api<T>(path: string, opts: ApiOptions<T>): Promise<T> {
  const response = await send(path, opts);
  if (response.ok) return parse(response, opts.schema);

  const error = await errorFromResponse(response);
  if (response.status !== 401 || !REFRESHABLE.has(error.code)) throw error;

  const outcome = await refreshSession();
  if (outcome === 'failed') {
    if (opts.session !== 'optional') {
      settings.onSessionLost(`${window.location.pathname}${window.location.search}`);
    }
    throw error;
  }
  if (outcome === 'race') await delay(settings.raceDelayMs);

  const replay = await send(path, opts);
  if (replay.ok) return parse(replay, opts.schema);
  throw await errorFromResponse(replay);
}
