// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { api, configureApiClient } from './api-client';
import { ApiError } from './api-error';

type Reply = [status: number, body: unknown];

let replies: Reply[] = [];
let calls: [method: string, url: string, body: string][] = [];
let onSessionLost: ReturnType<typeof vi.fn<(next: string) => void>>;

function respond([status, body]: Reply): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req_header' },
  });
}

function err(code: string): { error: { code: string; message: string; requestId: string } } {
  return { error: { code, message: code, requestId: 'req_1' } };
}

beforeEach(() => {
  replies = [];
  calls = [];
  onSessionLost = vi.fn<(next: string) => void>();
  configureApiClient({ onSessionLost, raceDelayMs: 1 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push([init.method ?? 'GET', url, typeof init.body === 'string' ? init.body : '']);
      const next = replies.shift();
      if (next === undefined) throw new Error(`unexpected request ${url}`);
      await Promise.resolve();
      return respond(next);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ok = z.object({ ok: z.boolean() });

describe('api', () => {
  it('parses successful responses with the schema', async () => {
    replies = [[200, { a: 1 }]];

    await expect(api('/x', { schema: z.object({ a: z.number() }) })).resolves.toEqual({ a: 1 });
    expect(calls).toEqual([['GET', '/api/x', '']]);
  });

  it('sends the same-origin fetch marker and JSON', async () => {
    replies = [[200, { ok: true }]];

    await api('/v1/x', { method: 'POST', body: { a: 1 }, schema: ok });

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('X-Requested-With')).toBe('fetch');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(init?.credentials).toBe('same-origin');
  });

  it('accepts an empty 204 response', async () => {
    replies = [[204, undefined]];

    await expect(
      api('/v1/x', { method: 'DELETE', schema: z.undefined() }),
    ).resolves.toBeUndefined();
  });

  it('throws ApiError from the envelope', async () => {
    replies = [
      [
        400,
        {
          error: {
            code: 'validation_failed',
            message: 'm',
            details: [{ path: 'name', message: 'Required' }],
            requestId: 'req_1',
          },
        },
      ],
    ];

    const failure = api('/x', { schema: ok });

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      code: 'validation_failed',
      status: 400,
      requestId: 'req_1',
      details: [{ path: 'name', message: 'Required' }],
    });
  });

  it('refreshes once and replays the same body', async () => {
    replies = [
      [401, err('token_expired')],
      [200, { ok: true }],
      [200, { ok: true }],
    ];

    await api('/v1/x', { method: 'POST', body: { name: 'draft' }, schema: ok });

    expect(calls).toEqual([
      ['POST', '/api/v1/x', '{"name":"draft"}'],
      ['POST', '/api/v1/auth/refresh', ''],
      ['POST', '/api/v1/x', '{"name":"draft"}'],
    ]);
  });

  it('concurrent 401s trigger one refresh', async () => {
    replies = [
      [401, err('token_expired')],
      [401, err('token_expired')],
      [401, err('token_expired')],
      [200, { ok: true }],
      [200, { ok: true }],
      [200, { ok: true }],
      [200, { ok: true }],
    ];

    await Promise.all([
      api('/v1/a', { schema: ok }),
      api('/v1/b', { schema: ok }),
      api('/v1/c', { schema: ok }),
    ]);

    expect(calls.filter(([, url]) => url === '/api/v1/auth/refresh')).toHaveLength(1);
    expect(calls).toHaveLength(7);
  });

  it('retries after refresh_race', async () => {
    replies = [
      [401, err('token_expired')],
      [401, err('refresh_race')],
      [200, { ok: true }],
    ];

    await expect(api('/v1/x', { schema: ok })).resolves.toEqual({ ok: true });
    expect(calls.map(([, url]) => url)).toEqual(['/api/v1/x', '/api/v1/auth/refresh', '/api/v1/x']);
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it('redirects to login when refresh fails', async () => {
    window.history.replaceState(null, '', '/w/123/settings?tab=members');
    replies = [
      [401, err('unauthorized')],
      [401, err('session_revoked')],
    ];

    await expect(api('/v1/x', { schema: ok })).rejects.toMatchObject({ code: 'unauthorized' });
    expect(onSessionLost).toHaveBeenCalledWith('/w/123/settings?tab=members');
  });

  it('sends the user to login when the session was revoked elsewhere', async () => {
    window.history.replaceState(null, '', '/account');
    replies = [
      [401, err('session_revoked')],
      [401, err('session_revoked')],
    ];

    await expect(api('/v1/x', { schema: ok })).rejects.toMatchObject({ code: 'session_revoked' });
    expect(onSessionLost).toHaveBeenCalledWith('/account');
  });

  it('keeps the user signed in when the refresh endpoint is briefly unavailable', async () => {
    replies = [
      [401, err('token_expired')],
      [503, err('internal_error')],
    ];

    await expect(
      api('/v1/x', { method: 'POST', body: { name: 'draft' }, schema: ok }),
    ).rejects.toMatchObject({ status: 503 });
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it('keeps the user signed in when the refresh request fails on the network', async () => {
    replies = [[401, err('token_expired')]];
    const realFetch = vi.mocked(fetch).getMockImplementation();
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (typeof url === 'string' && url.endsWith('/auth/refresh')) {
        throw new TypeError('Failed to fetch');
      }
      if (realFetch === undefined) throw new Error('no fetch');
      return realFetch(url, init);
    });

    await expect(api('/v1/x', { schema: ok })).rejects.toBeInstanceOf(ApiError);
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it('never redirects for requests where a session is optional', async () => {
    replies = [
      [401, err('unauthorized')],
      [401, err('unauthorized')],
    ];

    await expect(api('/v1/auth/me', { schema: ok, session: 'optional' })).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(calls.map(([, url]) => url)).toEqual(['/api/v1/auth/me', '/api/v1/auth/refresh']);
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it('fails loudly when the response does not match the schema', async () => {
    replies = [[200, { ok: 'yes' }]];

    await expect(api('/x', { schema: ok })).rejects.toMatchObject({
      code: 'internal_error',
      message: 'Unexpected response shape',
    });
  });
});
