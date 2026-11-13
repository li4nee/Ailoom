// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchPage } from './fetch-page';
import { ROBOTS_CACHE_TTL_MS, RobotsService } from './robots.service';

vi.mock('./fetch-page', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fetch-page')>();
  return { ...actual, fetchPage: vi.fn() };
});

const UA = 'AiLoomBot';
const fetchMock = vi.mocked(fetchPage);

function robots(body: string) {
  return { body: Buffer.from(body) } as never;
}

function build() {
  return new RobotsService({ userAgent: UA } as never, {});
}

describe('RobotsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads robots.txt once per origin across many page checks', async () => {
    fetchMock.mockResolvedValue(robots('User-agent: *\nDisallow: /private'));
    const service = build();

    const results = await Promise.all([
      service.allowed('https://a.test/one', UA),
      service.allowed('https://a.test/two', UA),
      service.allowed('https://a.test/private/x', UA),
    ]);

    expect(results).toEqual([true, true, false]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://a.test/robots.txt');
  });

  it('keeps a separate cache for each origin', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        url === 'https://a.test/robots.txt'
          ? robots('User-agent: *\nDisallow: /')
          : robots('User-agent: *\nAllow: /'),
      ),
    );
    const service = build();

    expect(await service.allowed('https://a.test/page', UA)).toBe(false);
    expect(await service.allowed('https://b.test/page', UA)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads robots.txt again once the TTL has passed', async () => {
    fetchMock.mockResolvedValueOnce(robots('User-agent: *\nDisallow: /'));
    fetchMock.mockResolvedValueOnce(robots('User-agent: *\nAllow: /'));
    const service = build();

    expect(await service.allowed('https://a.test/page', UA)).toBe(false);
    vi.advanceTimersByTime(ROBOTS_CACHE_TTL_MS - 1);
    expect(await service.allowed('https://a.test/page', UA)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(await service.allowed('https://a.test/page', UA)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sweeps expired origins when a new one is cached', async () => {
    fetchMock.mockResolvedValue(robots('User-agent: *\nAllow: /'));
    const service = build();
    const cache = (service as unknown as { cache: Map<string, unknown> }).cache;

    await service.allowed('https://a.test/page', UA);
    vi.advanceTimersByTime(ROBOTS_CACHE_TTL_MS);
    await service.allowed('https://b.test/page', UA);

    expect([...cache.keys()]).toEqual(['https://b.test']);
  });

  it('allows the crawl when robots.txt cannot be fetched', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const service = build();

    expect(await service.allowed('https://a.test/page', UA)).toBe(true);
  });
});
