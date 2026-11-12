// SPDX-License-Identifier: MIT

/**
 * The messages an invalid allowed origin is rejected with. The API returns them and the admin
 * shows them before the round trip, so both read the same text from here.
 */
export const ORIGIN_ERRORS = {
  invalid: 'Enter an origin such as https://example.com',
  protocol: 'Origins must use http or https',
  path: 'Origins cannot contain a path',
  credentials: 'Origins cannot contain credentials',
  wildcard: 'Use https://*.example.com for subdomains',
} as const;

export type OriginCheck = { value: string } | { error: string };

/**
 * Turns an admin-supplied allowed origin into its canonical form (spec §9.2), or names why it is
 * rejected.
 *
 * Only a scheme and a host are kept: the widget's `Origin` header never carries a path, query or
 * fragment, so accepting one would create a rule that can never match. `*.example.com` is the
 * one wildcard, and it covers every subdomain depth (`a.b.example.com`), not `example.com`.
 */
export function normalizeOrigin(pattern: string): OriginCheck {
  const trimmed = pattern.trim();
  if (trimmed === '*') return { error: ORIGIN_ERRORS.wildcard };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: ORIGIN_ERRORS.invalid };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: ORIGIN_ERRORS.protocol };
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return { error: ORIGIN_ERRORS.path };
  }
  if (url.username !== '' || url.password !== '') {
    return { error: ORIGIN_ERRORS.credentials };
  }
  // `URL` reads `https://*` as the host `*`; only a `*.` prefix is a wildcard.
  const hostname = url.hostname.toLowerCase();
  if (hostname === '*' || (hostname.includes('*') && !hostname.startsWith('*.'))) {
    return { error: ORIGIN_ERRORS.wildcard };
  }
  return { value: `${url.protocol}//${url.host}` };
}
