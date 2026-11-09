// SPDX-License-Identifier: AGPL-3.0-only
import * as ipaddr from 'ipaddr.js';

import { SafeFetchError } from './safe-fetch-error';

export interface ParsedTarget {
  url: URL;
  host: string;
  port: number;
  hostIsIp: boolean;
}

/**
 * Canonical form used for every host comparison: lowercase, IPv6 brackets removed and one
 * trailing dot dropped, so `POSTGRES`, `postgres.` and `postgres` are the same host.
 */
export function normalizeHost(raw: string): string {
  let host = raw.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

export function parseTarget(raw: string): ParsedTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('blocked_scheme');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('blocked_scheme');
  }
  // url.hostname normalizes numeric IPv4 forms but keeps IPv6 brackets ("[::1]").
  const host = normalizeHost(url.hostname);
  const hostIsIp = ipaddr.isValid(host);
  const port = url.port !== '' ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SafeFetchError('blocked_port');
  }
  return { url, host, port, hostIsIp };
}
