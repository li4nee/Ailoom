// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { applyLinkPolicy, buildAllowedLinkHosts, type HostMatcher } from './link-policy';

function allow(
  domains: string[],
  origins: string[] = [],
  usedUrls: (string | null)[] = [],
): HostMatcher {
  return buildAllowedLinkHosts({
    usedSourceUrls: usedUrls,
    allowedOrigins: origins,
    allowedLinkDomains: domains,
  });
}

describe('applyLinkPolicy', () => {
  it('drops links to unknown hosts', () => {
    expect(applyLinkPolicy('see [here](https://evil.test/x)', allow(['shop.com']))).toBe(
      'see here',
    );
  });

  it('keeps links to cited sources', () => {
    expect(
      applyLinkPolicy(
        'see [refunds](https://shop.example/refunds)',
        allow([], [], ['https://shop.example/refunds']),
      ),
    ).toBe('see [refunds](https://shop.example/refunds)');
  });

  it('keeps links to subdomain patterns', () => {
    expect(applyLinkPolicy('see [help](https://help.shop.com/a)', allow(['*.shop.com']))).toBe(
      'see [help](https://help.shop.com/a)',
    );
  });

  it('keeps links to allowed origins', () => {
    expect(
      applyLinkPolicy('see [buy](https://shop.com/checkout)', allow([], ['https://shop.com'])),
    ).toBe('see [buy](https://shop.com/checkout)');
  });

  it('keeps mailto links', () => {
    expect(applyLinkPolicy('mail [us](mailto:help@shop.com)', allow([]))).toBe(
      'mail [us](mailto:help@shop.com)',
    );
  });

  it('drops javascript: and data: links', () => {
    expect(applyLinkPolicy('[x](javascript:alert(1))', allow(['shop.com']))).toBe('x');
    expect(applyLinkPolicy('[x](data:text/html;base64,aGk=)', allow(['shop.com']))).toBe('x');
  });

  it('removes images', () => {
    expect(applyLinkPolicy('![x](https://shop.com/a.png)', allow(['shop.com']))).toBe('');
    expect(applyLinkPolicy('before ![x](https://evil.test/a.png) after', allow([]))).toBe(
      'before  after',
    );
  });

  it('defangs disallowed autolinks', () => {
    expect(applyLinkPolicy('<https://evil.test>', allow([]))).toBe('`https://evil.test`');
    expect(applyLinkPolicy('<https://shop.com/a>', allow(['shop.com']))).toBe(
      '<https://shop.com/a>',
    );
  });

  it('leaves plain text untouched', () => {
    expect(applyLinkPolicy('No links here. [1]', allow([]))).toBe('No links here. [1]');
  });
});
