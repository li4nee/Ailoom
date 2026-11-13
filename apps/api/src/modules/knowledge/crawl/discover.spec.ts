// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { discoverUrls, type DiscoverFetcher } from './discover';
import { parseSitemap } from './sitemap-parser';
import { normalizeCrawlUrl, registrableDomainOf } from './url-normalize';

const OPTIONS = {
  maxPages: 500,
  include: [],
  exclude: [],
  respectRobots: true,
  userAgent: 'TestCrawler/1.0',
};

function sitemap(urls: string[]): string {
  return `<?xml version="1.0"?><urlset>${urls
    .map((url) => `<url><loc>${url}</loc></url>`)
    .join('')}</urlset>`;
}

function index(sitemaps: string[]): string {
  return `<?xml version="1.0"?><sitemapindex>${sitemaps
    .map((url) => `<sitemap><loc>${url}</loc></sitemap>`)
    .join('')}</sitemapindex>`;
}

function fetcher(routes: Record<string, string>): DiscoverFetcher {
  return (url) => {
    const body = routes[url];
    if (body === undefined) return Promise.reject(new Error(`404 ${url}`));
    return Promise.resolve({
      finalUrl: url,
      contentType: 'application/xml',
      body: Buffer.from(body),
    });
  };
}

describe('normalizeCrawlUrl', () => {
  it.each([
    ['https://Ex.com:443/a/?utm_source=x&b=2&a=1#top', 'https://ex.com/a?a=1&b=2'],
    ['https://ex.com/', 'https://ex.com/'],
    ['https://ex.com/a#frag', 'https://ex.com/a'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeCrawlUrl(input)).toBe(expected);
  });

  it('finds the registrable domain across public suffixes', () => {
    expect(registrableDomainOf('docs.ex.com')).toBe('ex.com');
    expect(registrableDomainOf('shop.ex.co.uk')).toBe('ex.co.uk');
  });
});

describe('parseSitemap', () => {
  it('reads a urlset', () => {
    expect(parseSitemap(sitemap(['https://ex.com/a', 'https://ex.com/b']))).toEqual({
      urls: ['https://ex.com/a', 'https://ex.com/b'],
      sitemaps: [],
    });
  });

  it('reads a sitemap index', () => {
    expect(parseSitemap(index(['https://ex.com/a.xml']))).toEqual({
      urls: [],
      sitemaps: ['https://ex.com/a.xml'],
    });
  });

  it('returns nothing for a page that is not a sitemap', () => {
    expect(parseSitemap('<html><body>nope</body></html>')).toEqual({ urls: [], sitemaps: [] });
  });
});

describe('discoverUrls', () => {
  it('keeps the same registrable domain only', async () => {
    const found = await discoverUrls(
      'https://ex.com/sitemap.xml',
      OPTIONS,
      fetcher({
        'https://ex.com/sitemap.xml': sitemap([
          'https://docs.ex.com/a',
          'https://ex.com/b',
          'https://other.com/c',
        ]),
      }),
    );

    expect(found.urls).toEqual(['https://docs.ex.com/a', 'https://ex.com/b']);
    expect(found.skipped).toContainEqual({ url: 'https://other.com/c', reason: 'other_domain' });
  });

  it('applies include and exclude globs to the pathname', async () => {
    const found = await discoverUrls(
      'https://ex.com/sitemap.xml',
      { ...OPTIONS, include: ['/docs/**'], exclude: ['/docs/internal/**'] },
      fetcher({
        'https://ex.com/sitemap.xml': sitemap([
          'https://ex.com/docs/a',
          'https://ex.com/docs/internal/b',
          'https://ex.com/blog/c',
        ]),
      }),
    );

    expect(found.urls).toEqual(['https://ex.com/docs/a']);
  });

  it('respects robots.txt unless disabled', async () => {
    const routes = {
      'https://ex.com/sitemap.xml': sitemap(['https://ex.com/private', 'https://ex.com/public']),
      'https://ex.com/robots.txt': 'User-agent: *\nDisallow: /private\n',
    };
    const respecting = await discoverUrls('https://ex.com/sitemap.xml', OPTIONS, fetcher(routes));
    expect(respecting.urls).toEqual(['https://ex.com/public']);
    expect(respecting.skipped).toContainEqual({
      url: 'https://ex.com/private',
      reason: 'robots',
    });

    const ignoring = await discoverUrls(
      'https://ex.com/sitemap.xml',
      { ...OPTIONS, respectRobots: false },
      fetcher(routes),
    );
    expect(ignoring.urls).toEqual(['https://ex.com/private', 'https://ex.com/public']);
  });

  it('dedupes equivalent URLs', async () => {
    const found = await discoverUrls(
      'https://ex.com/sitemap.xml',
      OPTIONS,
      fetcher({
        'https://ex.com/sitemap.xml': sitemap([
          'https://ex.com/a',
          'https://ex.com/a/',
          'https://ex.com/a#frag',
          'https://ex.com/a?utm_source=x',
        ]),
      }),
    );
    expect(found.urls).toEqual(['https://ex.com/a']);
  });

  it('stops at maxPages and reports the rest as limit', async () => {
    const found = await discoverUrls(
      'https://ex.com/sitemap.xml',
      { ...OPTIONS, maxPages: 2 },
      fetcher({
        'https://ex.com/sitemap.xml': sitemap([
          'https://ex.com/a',
          'https://ex.com/b',
          'https://ex.com/c',
        ]),
      }),
    );

    expect(found.urls).toEqual(['https://ex.com/a', 'https://ex.com/b']);
    expect(found.skipped).toContainEqual({ url: 'https://ex.com/c', reason: 'limit' });
  });

  it('follows a sitemap index three levels deep', async () => {
    const found = await discoverUrls(
      'https://ex.com/sitemap.xml',
      OPTIONS,
      fetcher({
        'https://ex.com/sitemap.xml': index(['https://ex.com/one.xml']),
        'https://ex.com/one.xml': index(['https://ex.com/two.xml']),
        'https://ex.com/two.xml': sitemap(['https://ex.com/deep']),
      }),
    );
    expect(found.urls).toEqual(['https://ex.com/deep']);
  });

  it('falls back from /sitemap.xml to the robots.txt Sitemap lines', async () => {
    const found = await discoverUrls(
      'https://ex.com/',
      OPTIONS,
      fetcher({
        'https://ex.com/robots.txt': 'User-agent: *\nSitemap: https://ex.com/other.xml\n',
        'https://ex.com/other.xml': sitemap(['https://ex.com/page']),
      }),
    );
    expect(found.urls).toEqual(['https://ex.com/page']);
  });
});
