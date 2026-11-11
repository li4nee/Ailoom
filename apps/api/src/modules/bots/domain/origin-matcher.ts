// SPDX-License-Identifier: AGPL-3.0-only
import { AppError } from '../../../common/errors';

/** The protocol and host a pattern or an incoming Origin header carries, lowercased. */
function splitOrigin(value: string): { protocol: string; host: string } {
  const url = new URL(value);
  return { protocol: url.protocol, host: url.host.toLowerCase() };
}

/**
 * Turns an admin-supplied allowed origin into its canonical form, or rejects it with a message
 * the settings form shows verbatim.
 *
 * Only a scheme and a host are stored: the widget's `Origin` header never carries a path, query
 * or fragment, so accepting one would create a rule that can never match. `*.example.com` is the
 * one wildcard, and it covers every subdomain depth (`a.b.example.com`), not `example.com`.
 */
export function normalizeOriginPattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (trimmed === '*') {
    throw new AppError('validation_failed', {
      message: 'Use https://*.example.com for subdomains',
      details: [{ path: 'allowedOrigins', message: 'Use https://*.example.com for subdomains' }],
    });
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppError('validation_failed', {
      details: [{ path: 'allowedOrigins', message: 'Enter an origin such as https://example.com' }],
    });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('validation_failed', {
      details: [{ path: 'allowedOrigins', message: 'Origins must use http or https' }],
    });
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new AppError('validation_failed', {
      message: 'Origins cannot contain a path',
      details: [{ path: 'allowedOrigins', message: 'Origins cannot contain a path' }],
    });
  }
  if (url.username !== '' || url.password !== '') {
    throw new AppError('validation_failed', {
      details: [{ path: 'allowedOrigins', message: 'Origins cannot contain credentials' }],
    });
  }

  // `URL` reads `https://*` as the host `*`; only a `*.` prefix is a wildcard.
  if (url.hostname === '*') {
    throw new AppError('validation_failed', {
      message: 'Use https://*.example.com for subdomains',
      details: [{ path: 'allowedOrigins', message: 'Use https://*.example.com for subdomains' }],
    });
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname.includes('*') && !hostname.startsWith('*.')) {
    throw new AppError('validation_failed', {
      message: 'Use https://*.example.com for subdomains',
      details: [{ path: 'allowedOrigins', message: 'Use https://*.example.com for subdomains' }],
    });
  }

  return `${url.protocol}//${url.host}`;
}

/**
 * Whether a widget request from `origin` may use the bot. An empty list disables the widget
 * everywhere; an unparsable or absent `Origin` matches nothing.
 */
export function matchesAllowedOrigin(origin: string | null, patterns: string[]): boolean {
  if (origin === null || patterns.length === 0) return false;

  let actual: { protocol: string; host: string };
  try {
    actual = splitOrigin(origin);
  } catch {
    return false;
  }

  return patterns.some((pattern) => {
    let allowed: { protocol: string; host: string };
    try {
      allowed = splitOrigin(pattern);
    } catch {
      return false;
    }
    if (allowed.protocol !== actual.protocol) return false;
    if (!allowed.host.startsWith('*.')) return allowed.host === actual.host;

    // `*.example.com` covers subdomains only: the bare domain must be listed separately.
    const suffix = allowed.host.slice(1);
    return actual.host.endsWith(suffix) && actual.host !== allowed.host.slice(2);
  });
}
