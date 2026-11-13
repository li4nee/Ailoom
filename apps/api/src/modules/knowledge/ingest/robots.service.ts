// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';

import type { FetchPolicy } from '../../../common/safe-fetch';
import { RobotsCache } from '../crawl/robots';
import { CRAWL_FETCH_POLICY, FETCH_DEPS, fetchPage, type FetchDeps } from './fetch-page';

/** robots.txt is re-read at most this often, shared across every page job of a crawl. */
export const ROBOTS_CACHE_TTL_MS = 10 * 60_000;

/**
 * Instance-wide robots.txt lookups (spec §12.1). Page jobs run concurrently and each one
 * needs the rules of its own origin; a cache per job would fetch robots.txt once per page, so
 * this provider keeps one `RobotsCache` per origin and expires it after a few minutes.
 */
@Injectable()
export class RobotsService {
  private readonly cache = new Map<string, { expiresAt: number; robots: RobotsCache }>();

  constructor(
    @Inject(CRAWL_FETCH_POLICY) private readonly policy: FetchPolicy,
    @Inject(FETCH_DEPS) private readonly deps: FetchDeps,
  ) {}

  async allowed(url: string, userAgent: string): Promise<boolean> {
    return this.cacheFor(new URL(url).origin).allowed(url, userAgent);
  }

  private cacheFor(origin: string): RobotsCache {
    const now = Date.now();
    const cached = this.cache.get(origin);
    if (cached !== undefined && cached.expiresAt > now) return cached.robots;

    const robots = new RobotsCache(async (robotsUrl) => {
      try {
        return await fetchPage(robotsUrl, this.policy, this.deps);
      } catch {
        return null;
      }
    });
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    this.cache.set(origin, { expiresAt: now + ROBOTS_CACHE_TTL_MS, robots });
    return robots;
  }
}
