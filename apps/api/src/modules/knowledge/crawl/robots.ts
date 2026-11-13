// SPDX-License-Identifier: AGPL-3.0-only
import robotsParser from 'robots-parser';

/** Spec §12.1: a crawl never waits longer than this between two requests to one host. */
export const MAX_CRAWL_DELAY_MS = 10_000;

interface Robots {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
  getCrawlDelay(userAgent?: string): number | undefined;
  getSitemaps(): string[];
}

export type RobotsFetch = (url: string) => Promise<{ body: Buffer } | null>;

/**
 * robots.txt lookups for one crawl run (spec §12.1). Each origin is fetched at most once and
 * cached for the job; a missing or unreadable robots.txt allows everything, which is what
 * RFC 9309 says a site without one means.
 */
export class RobotsCache {
  private readonly cache = new Map<string, Promise<Robots | null>>();

  constructor(private readonly fetch: RobotsFetch) {}

  /** Whether `url` may be fetched. `crawlDelayMs` is separate: discovery checks many URLs. */
  async allowed(url: string, userAgent: string): Promise<boolean> {
    const robots = await this.load(new URL(url).origin);
    return robots === null ? true : robots.isAllowed(url, userAgent) !== false;
  }

  async crawlDelayMs(url: string, userAgent: string): Promise<number> {
    const robots = await this.load(new URL(url).origin);
    const seconds = robots?.getCrawlDelay(userAgent) ?? 0;
    return Math.min(Math.max(seconds, 0) * 1000, MAX_CRAWL_DELAY_MS);
  }

  async sitemaps(origin: string): Promise<string[]> {
    const robots = await this.load(origin);
    return robots?.getSitemaps() ?? [];
  }

  private load(origin: string): Promise<Robots | null> {
    let pending = this.cache.get(origin);
    if (pending === undefined) {
      pending = this.read(`${origin}/robots.txt`);
      this.cache.set(origin, pending);
    }
    return pending;
  }

  private async read(url: string): Promise<Robots | null> {
    try {
      const response = await this.fetch(url);
      if (response === null) return null;
      return robotsParser(url, response.body.toString('utf8'));
    } catch {
      // A site that blocks or breaks robots.txt is treated as allowing the crawl; the page
      // fetch itself still goes through the safe-fetch policy.
      return null;
    }
  }
}
