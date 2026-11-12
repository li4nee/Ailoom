// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeOrigin } from '@app/shared';

import { AppError } from '../../../common/errors';

/** The protocol and host a pattern or an incoming Origin header carries, lowercased. */
function splitOrigin(value: string): { protocol: string; host: string } {
  const url = new URL(value);
  return { protocol: url.protocol, host: url.host.toLowerCase() };
}

/**
 * The canonical form of an admin-supplied allowed origin, or a `validation_failed` whose message
 * the settings form shows verbatim. The rule lives in `@app/shared` so the admin checks the same
 * thing before saving.
 */
export function normalizeOriginPattern(pattern: string): string {
  const result = normalizeOrigin(pattern);
  if ('value' in result) return result.value;
  throw new AppError('validation_failed', {
    message: result.error,
    details: [{ path: 'allowedOrigins', message: result.error }],
  });
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
