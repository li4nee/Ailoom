// SPDX-License-Identifier: AGPL-3.0-only
import { lookup as dnsLookup } from 'node:dns/promises';

import { Agent, fetch, type Response as UndiciResponse } from 'undici';

import {
  assertAddressesAllowed,
  assertHostAllowed,
  type ResolvedAddress,
} from './check-destination';
import { parseTarget } from './parse-target';
import type { FetchPolicy, LookupFn } from './policies';
import { SafeFetchError } from './safe-fetch-error';

const DEFAULT_LOOKUP: LookupFn = async (host: string): Promise<ResolvedAddress[]> => {
  const results = await dnsLookup(host, { all: true, order: 'verbatim' });
  return results.map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
/** Dropped when a redirect turns the request into a body-less GET (Fetch spec §4.4). */
const BODY_HEADERS = ['content-type', 'content-length', 'content-encoding', 'content-language'];
/** Dropped when a redirect leaves the origin, so credentials never reach another host. */
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

const ignore = (): void => {
  // Best-effort cleanup: the request already failed or finished.
};

function inferFamily(address: string): 4 | 6 {
  return address.includes(':') ? 6 : 4;
}

/** An Agent whose every connection goes to the address that was validated. */
function pinnedAgent(pinned: ResolvedAddress, connectTimeoutMs: number): Agent {
  return new Agent({
    connect: {
      timeout: connectTimeoutMs,
      lookup: (_hostname, options, cb) => {
        if ((options as { all?: boolean } | undefined)?.all === true) {
          cb(null, [{ address: pinned.address, family: pinned.family }]);
          return;
        }
        cb(null, pinned.address, pinned.family);
      },
    },
  });
}

/**
 * Re-streams the response body with pull-based backpressure, failing with `too_large`
 * past `maxBytes`. `release` runs exactly once, when the body ends, errors or is cancelled.
 */
function guardBody(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
  mapError: (err: unknown) => unknown,
  release: (finished: boolean) => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let received = 0;
  let released = false;
  const releaseOnce = (finished: boolean): void => {
    if (released) return;
    released = true;
    release(finished);
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        releaseOnce(false);
        controller.error(mapError(err));
        return;
      }
      if (chunk.done) {
        releaseOnce(true);
        controller.close();
        return;
      }
      received += chunk.value.byteLength;
      if (received > maxBytes) {
        controller.error(new SafeFetchError('too_large'));
        await reader.cancel().catch(ignore);
        releaseOnce(false);
        return;
      }
      controller.enqueue(chunk.value);
    },
    async cancel(reason): Promise<void> {
      await reader.cancel(reason).catch(ignore);
      releaseOnce(false);
    },
  });
}

function contentTypeAllowed(response: UndiciResponse, allowed: string[] | null): boolean {
  if (allowed === null) return true;
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return type !== undefined && type !== '' && allowed.includes(type);
}

/**
 * Fetches `input` under `policy`: every hop is parsed, checked (scheme, host, port,
 * every resolved address) and connected to the pinned, validated address. Redirects are
 * followed manually up to `maxRedirects`. The returned body is limited to `maxBytes`.
 *
 * Errors are `SafeFetchError`s, except when the caller's `init.signal` aborts: then the
 * caller's abort reason is thrown (or errors the body) as-is. `timeout` means the
 * policy's `totalTimeoutMs`, which also covers reading the body.
 */
export async function safeFetch(
  input: string | URL,
  init: RequestInit & { signal?: AbortSignal },
  policy: FetchPolicy,
  deps?: { lookup?: LookupFn },
): Promise<Response> {
  const lookup = deps?.lookup ?? DEFAULT_LOOKUP;
  const callerSignal = init.signal ?? undefined;
  const timeoutSignal = AbortSignal.timeout(policy.totalTimeoutMs);
  const signal =
    callerSignal === undefined ? timeoutSignal : AbortSignal.any([callerSignal, timeoutSignal]);

  /** The error to surface once `signal` has aborted: the caller's reason or `timeout`. */
  const abortError = (): unknown => {
    if (callerSignal?.aborted === true && signal.reason === callerSignal.reason) {
      return callerSignal.reason as unknown;
    }
    return new SafeFetchError('timeout');
  };
  const mapError = (err: unknown): unknown => {
    if (signal.aborted) return abortError();
    if (err instanceof SafeFetchError) return err;
    return new SafeFetchError('connection_failed');
  };

  let target = parseTarget(input instanceof URL ? input.href : input);
  let method = (init.method ?? 'GET').toUpperCase();
  let body = init.body ?? undefined;
  const headers = new Headers(init.headers);
  headers.set('user-agent', policy.userAgent);
  let redirects = 0;

  for (;;) {
    if (signal.aborted) throw abortError();

    assertHostAllowed(target, policy);
    if (policy.allowedPorts !== 'any' && !policy.allowedPorts.includes(target.port)) {
      throw new SafeFetchError('blocked_port');
    }

    let addresses: ResolvedAddress[];
    if (target.hostIsIp) {
      addresses = [{ address: target.host, family: inferFamily(target.host) }];
    } else {
      try {
        addresses = await lookup(target.host);
      } catch {
        throw new SafeFetchError('dns_failed');
      }
    }
    const pinned = addresses[0];
    if (pinned === undefined) throw new SafeFetchError('dns_failed');
    assertAddressesAllowed(target, addresses, policy);

    const dispatcher = pinnedAgent(pinned, policy.connectTimeoutMs);
    const discard = async (response?: UndiciResponse): Promise<void> => {
      await response?.body?.cancel().catch(ignore);
      await dispatcher.destroy().catch(ignore);
    };

    let response: UndiciResponse;
    try {
      response = await fetch(target.url.href, {
        ...init,
        method,
        body,
        headers,
        signal,
        redirect: 'manual',
        dispatcher,
      } as never);
    } catch (err) {
      await discard();
      throw mapError(err);
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      await discard(response);
      if (redirects >= policy.maxRedirects) throw new SafeFetchError('too_many_redirects');
      const location = response.headers.get('location');
      if (location === null || location === '') throw new SafeFetchError('connection_failed');
      let next: URL;
      try {
        next = new URL(location, target.url);
      } catch {
        throw new SafeFetchError('connection_failed');
      }
      // Fetch spec redirect rules: 303 (except GET/HEAD) and 301/302 after POST become GET.
      const toGet =
        (response.status === 303 && method !== 'GET' && method !== 'HEAD') ||
        ((response.status === 301 || response.status === 302) && method === 'POST');
      if (toGet) {
        method = 'GET';
        body = undefined;
        for (const name of BODY_HEADERS) headers.delete(name);
      }
      if (next.origin !== target.url.origin) {
        for (const name of CREDENTIAL_HEADERS) headers.delete(name);
      }
      target = parseTarget(next.href);
      redirects++;
      continue;
    }

    if (!contentTypeAllowed(response, policy.contentTypes)) {
      await discard(response);
      throw new SafeFetchError('bad_content_type');
    }

    const responseInit = {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers as unknown as Headers,
    };
    const source = response.body as ReadableStream<Uint8Array> | null;
    if (source === null || NULL_BODY_STATUSES.has(response.status)) {
      await discard(response);
      return new Response(null, responseInit);
    }
    const limited = guardBody(source, policy.maxBytes, mapError, (finished) => {
      // Finished bodies close gracefully; errored or cancelled ones tear the socket down.
      (finished ? dispatcher.close() : dispatcher.destroy()).catch(ignore);
    });
    return new Response(limited, responseInit);
  }
}
