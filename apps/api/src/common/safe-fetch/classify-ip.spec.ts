// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { classifyIp } from './classify-ip';

describe('classifyIp', () => {
  it.each([
    ['8.8.8.8', 'public'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['127.0.0.1', 'loopback'],
    ['127.9.9.9', 'loopback'],
    ['0.0.0.0', 'unspecified'],
    ['169.254.169.254', 'metadata'],
    ['169.254.1.1', 'link_local'],
    ['100.64.0.1', 'cgnat'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'reserved'],
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link_local'],
    ['fc00::1', 'private'],
    ['fd00::1', 'private'],
    ['fd00:ec2::254', 'metadata'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:10.0.0.1', 'private'],
    ['2001:4860:4860::8888', 'public'],
    ['64:ff9b::7f00:1', 'loopback'],
    ['::127.0.0.1', 'reserved'],
    ['::8.8.8.8', 'reserved'],
  ] as const)('%s → %s', (ip, cls) => {
    expect(classifyIp(ip)).toBe(cls);
  });
});
