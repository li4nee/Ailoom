// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

export interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}

type Handler = (call: RecordedCall) => [status: number, body?: unknown];

/**
 * Stubs `fetch` with a route table keyed by `METHOD /api/path` (query string ignored). Unknown
 * routes fail the test loudly. Returns the list of calls made, in order.
 */
export function mockApi(routes: Record<string, Handler | [number, unknown?]>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      const call = { method, url, body };
      calls.push(call);
      const route = routes[`${method} ${url.split('?')[0] ?? url}`];
      if (route === undefined) throw new Error(`unmocked request ${method} ${url}`);
      const [status, payload] = typeof route === 'function' ? route(call) : route;
      return Promise.resolve(
        new Response(payload === undefined ? null : JSON.stringify(payload), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
  return calls;
}

export function apiError(
  code: string,
  details: { path: string; message: string }[] = [],
): { error: { code: string; message: string; details: typeof details; requestId: string } } {
  return { error: { code, message: code, details, requestId: 'req_test' } };
}
