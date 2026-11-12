// SPDX-License-Identifier: AGPL-3.0-only
import { gunzipSync } from 'node:zlib';

import picomatch from 'picomatch';

import { RobotsCache } from './robots';
import { parseSitemap } from './sitemap-parser';
import { normalizeCrawlUrl, registrableDomainOf } from './url-normalize';

/** Sitemap indexes nest; deeper than this is not a documentation site. */
const MAX_SITEMAP_DEPTH = 3;
/** A crawl reads at most this many sitemap files, whatever the index claims. */
const MAX_SITEMAPS = 50;

export interface DiscoverOptions {
  maxPages: number;
  include: string[];
  exclude: string[];
  respectRobots: boolean;
  userAgent: string;
}

export type SkipReason = 'other_domain' | 'excluded' | 'robots' | 'limit';

export interface SkippedUrl {
  url: string;
  reason: SkipReason;
}

export interface DiscoveredUrls {
  urls: string[];
  skipped: SkippedUrl[];
}

/** Just enough of `fetchPage` for discovery: sitemaps and robots.txt need the bytes only. */
export type DiscoverFetcher = (
  url: string,
) => Promise<{ finalUrl: string; contentType: string; body: Buffer }>;

function decode(url: string, body: Buffer): string {
  const gzipped = url.endsWith('.gz') || (body[0] === 0x1f && body[1] === 0x8b);
  return (gzipped ? gunzipSync(body) : body).toString('utf8');
}

function sitemapSeeds(start: URL): string[] {
  if (/\.xml(\.gz)?$/i.test(start.pathname)) return [start.href];
  return [`${start.origin}/sitemap.xml`];
}

/**
 * Finds the pages a sitemap source should index (spec §12.1). The start URL is a sitemap (or
 * sitemap index) when it ends in `.xml`; otherwise `/sitemap.xml` is tried, then the `Sitemap:`
 * lines of robots.txt. Only URLs on the start URL's registrable domain survive, include/exclude
 * globs are applied to the pathname, robots.txt is honoured unless disabled, and the result is
 * deduplicated by canonical URL and capped at `maxPages`.
 */
export async function discoverUrls(
  startUrl: string,
  opts: DiscoverOptions,
  fetcher: DiscoverFetcher,
): Promise<DiscoveredUrls> {
  const start = new URL(startUrl);
  const domain = registrableDomainOf(start.hostname);

  const robotsText = new RobotsCache(async (url) => {
    try {
      return await fetcher(url);
    } catch {
      return null;
    }
  });

  const pending = sitemapSeeds(start);
  if (opts.respectRobots) {
    pending.push(...(await robotsText.sitemaps(start.origin)));
  }

  const seenSitemaps = new Set<string>();
  const queue: { url: string; depth: number }[] = pending
    .filter((url) => URL.canParse(url))
    .map((url) => ({ url, depth: 1 }));

  const include = picomatch(opts.include, { dot: true });
  const exclude = picomatch(opts.exclude, { dot: true });

  const urls: string[] = [];
  const skipped: SkippedUrl[] = [];
  const seen = new Set<string>();

  while (queue.length > 0 && seenSitemaps.size < MAX_SITEMAPS) {
    const next = queue.shift();
    if (next === undefined) break;
    const sitemapUrl = normalizeCrawlUrl(next.url);
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);

    let parsed;
    try {
      const response = await fetcher(next.url);
      parsed = parseSitemap(decode(next.url, response.body));
    } catch {
      // A sitemap that 404s or is not XML just contributes nothing; the next seed may work.
      continue;
    }

    for (const nested of parsed.sitemaps) {
      if (next.depth < MAX_SITEMAP_DEPTH && URL.canParse(nested)) {
        queue.push({ url: nested, depth: next.depth + 1 });
      }
    }

    for (const candidate of parsed.urls) {
      if (!URL.canParse(candidate)) continue;
      const url = normalizeCrawlUrl(candidate);
      const target = new URL(url);

      if (domain === null || registrableDomainOf(target.hostname) !== domain) {
        skipped.push({ url, reason: 'other_domain' });
        continue;
      }
      const path = `${target.pathname}${target.search}`;
      if (
        (opts.include.length > 0 && !include(path)) ||
        (opts.exclude.length > 0 && exclude(path))
      ) {
        skipped.push({ url, reason: 'excluded' });
        continue;
      }
      if (seen.has(url)) continue;
      if (urls.length >= opts.maxPages) {
        skipped.push({ url, reason: 'limit' });
        continue;
      }
      if (opts.respectRobots && !(await robotsText.allowed(url, opts.userAgent))) {
        skipped.push({ url, reason: 'robots' });
        continue;
      }
      seen.add(url);
      urls.push(url);
    }
  }

  return { urls, skipped };
}
