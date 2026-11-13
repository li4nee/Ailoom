// SPDX-License-Identifier: AGPL-3.0-only
import { getDomain } from 'tldts';

/** Query parameters that never change the page: dropping them is what makes two URLs one. */
const TRACKING_PARAMS = /^(utm_.+|gclid|fbclid|mc_cid|mc_eid)$/i;

/**
 * The canonical form of a crawl URL (spec §12.1): no fragment, no tracking parameters,
 * parameters sorted, lower-case host, no default port, no trailing slash except at the root.
 * Two URLs that point at the same page therefore compare equal before deduplication.
 */
export function normalizeCrawlUrl(raw: string): string {
  const url = new URL(raw);
  const params = [...url.searchParams.entries()]
    .filter(([name]) => !TRACKING_PARAMS.test(name))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));

  const search = params.length === 0 ? '' : `?${new URLSearchParams(params).toString()}`;
  const path = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}${search}`;
}

/**
 * The registrable domain (`docs.ex.com` → `ex.com`) with the public-suffix list, so `co.uk`
 * sites are not treated as one domain. Null for an IP address or a single-label host.
 */
export function registrableDomainOf(hostname: string): string | null {
  return getDomain(hostname.toLowerCase());
}
