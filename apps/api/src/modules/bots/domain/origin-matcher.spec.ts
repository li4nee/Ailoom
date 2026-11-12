// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { matchesAllowedOrigin, normalizeOriginPattern } from './origin-matcher';

describe('matchesAllowedOrigin', () => {
  it.each<[string | null, string[], boolean]>([
    ['https://shop.com', ['https://shop.com'], true],
    ['https://shop.com:443', ['https://shop.com'], true],
    ['http://shop.com', ['https://shop.com'], false],
    ['https://a.shop.com', ['https://*.shop.com'], true],
    ['https://a.b.shop.com', ['https://*.shop.com'], true],
    ['https://shop.com', ['https://*.shop.com'], false],
    ['https://evilshop.com', ['https://*.shop.com'], false],
    ['http://localhost:3000', ['http://localhost:3000'], true],
    ['http://localhost:3001', ['http://localhost:3000'], false],
    ['null', ['https://shop.com'], false],
    [null, ['https://shop.com'], false],
  ])('%s vs %j → %s', (origin, patterns, expected) => {
    expect(matchesAllowedOrigin(origin, patterns)).toBe(expected);
  });

  it('treats an empty pattern list as disabled', () => {
    expect(matchesAllowedOrigin('https://shop.com', [])).toBe(false);
  });
});

describe('normalizeOriginPattern', () => {
  it('normalizes trailing slash and case', () => {
    expect(normalizeOriginPattern('HTTPS://Shop.com/')).toBe('https://shop.com');
  });

  it('drops the protocol default port', () => {
    expect(normalizeOriginPattern('https://shop.com:443')).toBe('https://shop.com');
    expect(normalizeOriginPattern('http://localhost:80')).toBe('http://localhost');
  });

  it('keeps a non-default port', () => {
    expect(normalizeOriginPattern('http://localhost:3000/')).toBe('http://localhost:3000');
  });

  it('keeps a wildcard subdomain pattern', () => {
    expect(normalizeOriginPattern('https://*.Shop.com')).toBe('https://*.shop.com');
  });

  it.each(['https://shop.com/app', '*', 'https://*', 'ftp://x.com', 'https://shop.com?x=1'])(
    'rejects %s',
    (pattern) => {
      expect(() => normalizeOriginPattern(pattern)).toThrow();
    },
  );

  it('explains how to allow subdomains', () => {
    expect(() => normalizeOriginPattern('https://*')).toThrow(
      'Use https://*.example.com for subdomains',
    );
  });

  it('rejects a path', () => {
    expect(() => normalizeOriginPattern('https://shop.com/app')).toThrow(
      'Origins cannot contain a path',
    );
  });
});
