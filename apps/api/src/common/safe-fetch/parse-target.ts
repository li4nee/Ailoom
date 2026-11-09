// SPDX-License-Identifier: AGPL-3.0-only
import ipaddr from 'ipaddr.js';

import { SafeFetchError } from './safe-fetch-error';

export interface ParsedTarget {
  url: URL;
  host: string;
  port: number;
  hostIsIp: boolean;
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
  // url.hostname strips brackets for IPv6 and normalizes numeric IPv4 forms.
  const host = url.hostname.toLowerCase();
  const hostIsIp = (() => {
    try {
      ipaddr.parse(host);
      return true;
    } catch {
      return false;
    }
  })();
  const port = url.port !== '' ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SafeFetchError('blocked_port');
  }
  return { url, host, port, hostIsIp };
}
