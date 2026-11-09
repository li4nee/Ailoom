// SPDX-License-Identifier: AGPL-3.0-only
import dns from 'node:dns/promises';

import { Agent, fetch } from 'undici';

import { classifyIp } from './classify-ip';
import { parseTarget, type ParsedTarget } from './parse-target';
import { isMetadataIp, type FetchPolicy, type LookupFn } from './policies';
import { SafeFetchError, type SafeFetchErrorCode } from './safe-fetch-error';

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

const DEFAULT_LOOKUP: LookupFn = async (host: string): Promise<ResolvedAddress[]> => {
  const results = await dns.lookup(host, { all: true, order: 'verbatim' });
  return results.map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
};

function combineSignals(signals: (AbortSignal | undefined)[]): AbortSignal {
  const active = signals.filter((s): s is AbortSignal => s !== undefined);
  if (active.length === 0) return new AbortController().signal;
  if (active.length === 1) {
    const only = active[0];
    if (only === undefined) return new AbortController().signal;
    return only;
  }
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(active);
  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener(
      'abort',
      () => {
        controller.abort(signal.reason);
      },
      { once: true },
    );
  }
  return controller.signal;
}

function isPublicIpClass(cls: ReturnType<typeof classifyIp>): boolean {
  return cls === 'public';
}

function checkHostAllowed(
  host: string,
  hostIsIp: boolean,
  policy: FetchPolicy,
): { allowed: boolean; reason?: SafeFetchErrorCode } {
  const lowerHost = host.toLowerCase();
  if (policy.denyHosts.includes(lowerHost)) {
    return { allowed: false, reason: 'blocked_host' };
  }
  if (hostIsIp) return { allowed: true };
  if (policy.allowHosts.length > 0 && !policy.allowHosts.includes(lowerHost)) {
    return { allowed: false, reason: 'blocked_host' };
  }
  return { allowed: true };
}

function checkPortAllowed(
  port: number,
  policy: FetchPolicy,
): { allowed: boolean; reason?: SafeFetchErrorCode } {
  if (policy.allowedPorts === 'any') return { allowed: true };
  if (!policy.allowedPorts.includes(port)) {
    return { allowed: false, reason: 'blocked_port' };
  }
  return { allowed: true };
}

async function resolveAddresses(host: string, lookup: LookupFn): Promise<ResolvedAddress[]> {
  try {
    const results = await lookup(host);
    return results;
  } catch {
    throw new SafeFetchError('dns_failed');
  }
}

function validateAddresses(
  addresses: ResolvedAddress[],
  allowPrivate: boolean,
): { allowed: boolean; reason?: SafeFetchErrorCode } {
  for (const { address } of addresses) {
    if (isMetadataIp(address)) {
      return { allowed: false, reason: 'blocked_address' };
    }
    const cls = classifyIp(address);
    if (cls === 'metadata') {
      return { allowed: false, reason: 'blocked_address' };
    }
    if (!allowPrivate && !isPublicIpClass(cls)) {
      return { allowed: false, reason: 'blocked_address' };
    }
  }
  return { allowed: true };
}

function createGuardedStream(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  contentTypeError: SafeFetchErrorCode | null,
): ReadableStream<Uint8Array> {
  let bytesRead = 0;
  return new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
      if (contentTypeError !== null) {
        controller.error(new SafeFetchError(contentTypeError));
        return;
      }
      if (body === null) {
        controller.close();
        return;
      }
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }
          bytesRead += value.byteLength;
          if (bytesRead > maxBytes) {
            controller.error(new SafeFetchError('too_large'));
            reader.cancel().catch(() => {
              // ignore cancel failures
            });
            break;
          }
          controller.enqueue(value);
        }
      } catch (err) {
        if (err instanceof SafeFetchError) {
          controller.error(err);
          return;
        }
        controller.error(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
}

function checkContentType(
  response: Response,
  allowedTypes: string[] | null,
): { allowed: boolean; reason?: SafeFetchErrorCode } {
  if (allowedTypes === null) return { allowed: true };
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType === undefined || contentType === '' || !allowedTypes.includes(contentType)) {
    return { allowed: false, reason: 'bad_content_type' };
  }
  return { allowed: true };
}

function isTimeoutError(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
    return true;
  return false;
}

function inferFamily(address: string): 4 | 6 {
  return address.includes(':') ? 6 : 4;
}

async function closeDispatcher(dispatcher: Agent): Promise<void> {
  try {
    await dispatcher.close();
  } catch {
    // ignore close errors
  }
}

export async function safeFetch(
  input: string | URL,
  init: RequestInit & { signal?: AbortSignal },
  policy: FetchPolicy,
  deps?: { lookup?: LookupFn },
): Promise<Response> {
  const lookup = deps?.lookup ?? DEFAULT_LOOKUP;
  const totalTimeoutMs = policy.totalTimeoutMs;
  const timeoutSignal =
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(totalTimeoutMs) : undefined;
  const timeoutController = timeoutSignal === undefined ? new AbortController() : undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (timeoutController !== undefined) {
    timeoutId = setTimeout(() => {
      timeoutController.abort(new Error('timeout'));
    }, totalTimeoutMs);
  }
  const abortSignal = combineSignals([init.signal, timeoutSignal ?? timeoutController?.signal]);

  let currentUrl = input instanceof URL ? input : new URL(input);
  let redirectCount = 0;

  try {
    for (;;) {
      if (abortSignal.aborted) throw new SafeFetchError('timeout');
      const parsed: ParsedTarget = parseTarget(currentUrl.toString());

      const hostCheck = checkHostAllowed(parsed.host, parsed.hostIsIp, policy);
      if (!hostCheck.allowed) {
        throw new SafeFetchError(hostCheck.reason ?? 'blocked_host');
      }

      const portCheck = checkPortAllowed(parsed.port, policy);
      if (!portCheck.allowed) {
        throw new SafeFetchError(portCheck.reason ?? 'blocked_port');
      }

      const addresses = parsed.hostIsIp
        ? [{ address: parsed.host, family: inferFamily(parsed.host) }]
        : await resolveAddresses(parsed.host, lookup);
      if (addresses.length === 0) throw new SafeFetchError('dns_failed');

      const addrCheck = validateAddresses(addresses, policy.allowPrivate);
      if (!addrCheck.allowed) {
        throw new SafeFetchError(addrCheck.reason ?? 'blocked_address');
      }

      const pinned = addresses[0];
      if (pinned === undefined) throw new SafeFetchError('dns_failed');

      const headers: Record<string, string> = {};
      if (init.headers !== undefined) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [key, value] of init.headers) headers[key] = value;
        } else {
          for (const [key, value] of Object.entries(init.headers)) {
            if (typeof value === 'string') {
              headers[key] = value;
            } else if (typeof value === 'number' || typeof value === 'boolean') {
              headers[key] = String(value);
            }
          }
        }
      }
      headers['User-Agent'] = policy.userAgent;

      const dispatcher = new Agent({
        connect: {
          timeout: policy.connectTimeoutMs,
          lookup: (_hostname, options, cb) => {
            const all = (options as { all?: boolean } | undefined)?.all === true;
            if (all) {
              cb(null, [{ address: pinned.address, family: pinned.family }]);
              return;
            }
            cb(null, pinned.address, pinned.family);
          },
        },
      });

      const requestInit = {
        ...init,
        signal: abortSignal,
        headers,
        redirect: 'manual' as const,
        dispatcher,
      };
      if (requestInit.body === null) delete (requestInit as { body?: unknown }).body;

      let response: Response;
      try {
        response = (await fetch(
          currentUrl.toString(),
          requestInit as never,
        )) as unknown as Response;
      } catch (err) {
        await closeDispatcher(dispatcher);
        if (err instanceof SafeFetchError) throw err;
        if (isTimeoutError(err, abortSignal)) {
          throw new SafeFetchError('timeout');
        }
        throw new SafeFetchError('connection_failed');
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel().catch(() => {
          // ignore
        });
        await closeDispatcher(dispatcher);
        if (redirectCount >= policy.maxRedirects) {
          throw new SafeFetchError('too_many_redirects');
        }
        const location = response.headers.get('location');
        if (location === null || location === '') {
          throw new SafeFetchError('connection_failed');
        }
        try {
          currentUrl = new URL(location, currentUrl);
        } catch {
          throw new SafeFetchError('connection_failed');
        }
        redirectCount++;
        continue;
      }

      const ctCheck = checkContentType(response, policy.contentTypes);
      const rawBody = response.body;
      const body = rawBody as unknown as ReadableStream<Uint8Array> | null;
      const limitedBody = createGuardedStream(
        body,
        policy.maxBytes,
        ctCheck.allowed ? null : (ctCheck.reason ?? 'bad_content_type'),
      );

      // Dispatcher is not closed on the success path so the stream can finish reading.
      return new Response(limitedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
