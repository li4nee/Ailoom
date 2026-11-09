// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { parseTarget } from './parse-target';

describe('parseTarget', () => {
  it.each(['http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://127.1/'])(
    '%s normalizes to 127.0.0.1',
    (raw) => {
      expect(parseTarget(raw).host).toBe('127.0.0.1');
    },
  );

  it.each(['file:///etc/passwd', 'gopher://x', 'ftp://x'])('%s is blocked', (raw) => {
    expect(() => parseTarget(raw)).toThrow(expect.objectContaining({ code: 'blocked_scheme' }));
  });

  it('defaults ports', () => {
    expect(parseTarget('https://a.com').port).toBe(443);
    expect(parseTarget('http://a.com').port).toBe(80);
  });

  it.each([
    ['http://[::1]/', '::1'],
    ['http://[::ffff:127.0.0.1]/', '::ffff:7f00:1'],
    ['http://[fd00:ec2::254]/', 'fd00:ec2::254'],
  ])('%s strips the IPv6 brackets', (raw, host) => {
    const target = parseTarget(raw);
    expect(target.host).toBe(host);
    expect(target.hostIsIp).toBe(true);
  });

  it.each([
    ['http://postgres./', 'postgres'],
    ['http://POSTGRES/', 'postgres'],
    ['http://Example.COM./x', 'example.com'],
  ])('%s normalizes the host to %s', (raw, host) => {
    const target = parseTarget(raw);
    expect(target.host).toBe(host);
    expect(target.hostIsIp).toBe(false);
  });
});
