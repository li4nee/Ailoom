// SPDX-License-Identifier: AGPL-3.0-only
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  // A sitemap is untrusted XML; no entity expansion beyond the five predefined entities.
  processEntities: true,
});

export interface ParsedSitemap {
  urls: string[];
  /** Nested sitemaps of a `sitemapindex`. */
  sitemaps: string[];
}

function locs(node: unknown): string[] {
  if (node === null || typeof node !== 'object') return [];
  const value = (node as { loc?: unknown }).loc;
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

/**
 * Reads a `urlset` or a `sitemapindex` (spec §12.1). Anything else — an HTML error page, a
 * malformed feed — yields no entries rather than throwing, so one bad sitemap skips instead of
 * failing the whole source.
 */
export function parseSitemap(xml: string): ParsedSitemap {
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch {
    return { urls: [], sitemaps: [] };
  }
  if (document === null || typeof document !== 'object') return { urls: [], sitemaps: [] };

  const root = document as Record<string, unknown>;
  const urlset = root['urlset'];
  if (urlset !== null && typeof urlset === 'object') {
    const entries = (urlset as { url?: unknown }).url;
    const list = Array.isArray(entries) ? entries : entries === undefined ? [] : [entries];
    return { urls: list.flatMap((entry) => locs(entry)), sitemaps: [] };
  }

  const index = root['sitemapindex'];
  if (index !== null && typeof index === 'object') {
    const entries = (index as { sitemap?: unknown }).sitemap;
    const list = Array.isArray(entries) ? entries : entries === undefined ? [] : [entries];
    return { urls: [], sitemaps: list.flatMap((entry) => locs(entry)) };
  }

  return { urls: [], sitemaps: [] };
}
