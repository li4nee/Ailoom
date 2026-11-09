// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { assertAddressesAllowed, assertHostAllowed } from './check-destination';
import { parseTarget } from './parse-target';
import type { FetchPolicy } from './policies';

const base: FetchPolicy = {
  name: 'provider',
  allowPrivate: false,
  allowHosts: [],
  denyHosts: [],
  allowedPorts: 'any',
  maxBytes: 1024,
  connectTimeoutMs: 1000,
  totalTimeoutMs: 1000,
  maxRedirects: 0,
  contentTypes: null,
  userAgent: 'test',
};

const v4 = (address: string): { address: string; family: 4 } => ({ address, family: 4 });
const v6 = (address: string): { address: string; family: 6 } => ({ address, family: 6 });

function check(raw: string, addresses: { address: string; family: 4 | 6 }[], policy: FetchPolicy) {
  const target = parseTarget(raw);
  return () => {
    assertHostAllowed(target, policy);
    assertAddressesAllowed(target, addresses, policy);
  };
}

describe('assertHostAllowed', () => {
  const deny = { ...base, denyHosts: ['postgres', 'metadata.google.internal', 'Evil.Example.'] };

  it.each([
    'http://postgres/',
    'http://postgres./',
    'http://POSTGRES/',
    'http://x.metadata.google.internal/',
    'http://a.b.metadata.google.internal./',
    'http://evil.example/',
    'http://sub.evil.example/',
  ])('%s → blocked_host', (raw) => {
    expect(() => {
      assertHostAllowed(parseTarget(raw), deny);
    }).toThrow(expect.objectContaining({ code: 'blocked_host' }));
  });

  it.each(['http://notpostgres/', 'http://postgres.example.com/', 'http://example.com/'])(
    '%s is not denied',
    (raw) => {
      expect(() => {
        assertHostAllowed(parseTarget(raw), deny);
      }).not.toThrow();
    },
  );
});

describe('assertAddressesAllowed', () => {
  it.each([
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00:ec2::254]/',
    'http://[::127.0.0.1]/',
  ])('%s literal → blocked_address', (raw) => {
    const target = parseTarget(raw);
    expect(() => {
      assertAddressesAllowed(target, [v6(target.host)], base);
    }).toThrow(expect.objectContaining({ code: 'blocked_address' }));
  });

  it.each(['169.254.170.2', '169.254.169.254', '0.0.0.0', '224.0.0.1', '240.0.0.1'])(
    '%s stays blocked with allowPrivate and a matching allowlist',
    (ip) => {
      const policy = { ...base, allowPrivate: true, allowHosts: [ip, '0.0.0.0/0'] };
      expect(check(`http://${ip}/`, [v4(ip)], policy)).toThrow(
        expect.objectContaining({ code: 'blocked_address' }),
      );
    },
  );

  it('blocks link-local IPv6 with allowPrivate', () => {
    expect(check('http://[fe80::1]/', [v6('fe80::1')], { ...base, allowPrivate: true })).toThrow(
      expect.objectContaining({ code: 'blocked_address' }),
    );
  });

  describe("allowHosts ['192.168.1.20'] with allowPrivate", () => {
    const policy = { ...base, allowPrivate: true, allowHosts: ['192.168.1.20'] };

    it('allows 192.168.1.20', () => {
      expect(check('http://192.168.1.20:11434/', [v4('192.168.1.20')], policy)).not.toThrow();
    });
    it('blocks 192.168.1.21', () => {
      expect(check('http://192.168.1.21:11434/', [v4('192.168.1.21')], policy)).toThrow(
        expect.objectContaining({ code: 'blocked_address' }),
      );
    });
    it('blocks a hostname resolving to another private address', () => {
      expect(check('http://nas.lan/', [v4('192.168.1.21')], policy)).toThrow(
        expect.objectContaining({ code: 'blocked_address' }),
      );
    });
    it('allows a hostname resolving to the listed address', () => {
      expect(check('http://nas.lan/', [v4('192.168.1.20')], policy)).not.toThrow();
    });
    it('still allows a public IP literal', () => {
      expect(check('http://8.8.8.8/', [v4('8.8.8.8')], policy)).not.toThrow();
    });
    it('still allows a public hostname', () => {
      expect(check('https://api.example.com/', [v4('93.184.216.34')], policy)).not.toThrow();
    });
  });

  it("allowHosts ['ollama'] allows host ollama resolving to a private address", () => {
    const policy = { ...base, allowPrivate: true, allowHosts: ['ollama'] };
    expect(check('http://ollama:11434/', [v4('172.18.0.5')], policy)).not.toThrow();
    expect(check('http://OLLAMA.:11434/', [v4('172.18.0.5')], policy)).not.toThrow();
    expect(check('http://other:11434/', [v4('172.18.0.5')], policy)).toThrow(
      expect.objectContaining({ code: 'blocked_address' }),
    );
  });

  it('allowHosts CIDR entries match resolved addresses (including IPv4-mapped)', () => {
    const policy = { ...base, allowPrivate: true, allowHosts: ['10.0.0.0/8'] };
    expect(check('http://gpu.lan/', [v4('10.4.5.6')], policy)).not.toThrow();
    expect(check('http://gpu.lan/', [v6('::ffff:10.4.5.6')], policy)).not.toThrow();
    expect(check('http://gpu.lan/', [v4('192.168.0.1')], policy)).toThrow(
      expect.objectContaining({ code: 'blocked_address' }),
    );
  });

  it('allowHosts is an exception list even when allowPrivate is false', () => {
    const policy = { ...base, allowPrivate: false, allowHosts: ['public.test'] };
    expect(check('http://public.test/', [v4('127.0.0.1')], policy)).not.toThrow();
    expect(check('http://other.test/', [v4('127.0.0.1')], policy)).toThrow(
      expect.objectContaining({ code: 'blocked_address' }),
    );
  });

  it('allowPrivate with an empty allowlist allows any private address', () => {
    const policy = { ...base, allowPrivate: true };
    expect(check('http://nas.lan/', [v4('192.168.1.21')], policy)).not.toThrow();
    expect(check('http://10.0.0.1/', [v4('10.0.0.1')], policy)).not.toThrow();
  });

  describe('loopback needs an explicit allowHosts entry', () => {
    it.each([
      ['http://127.0.0.1/', v4('127.0.0.1')],
      ['http://127.9.9.9/', v4('127.9.9.9')],
      ['http://[::1]/', v6('::1')],
      ['http://[::ffff:127.0.0.1]/', v6('::ffff:7f00:1')],
      ['http://[64:ff9b::7f00:1]/', v6('64:ff9b::7f00:1')],
      ['http://localhost/', v4('127.0.0.1')],
    ])('%s is blocked with allowPrivate and an empty allowlist', (raw, address) => {
      expect(check(raw, [address], { ...base, allowPrivate: true })).toThrow(
        expect.objectContaining({ code: 'blocked_address' }),
      );
    });

    it('is blocked when allowHosts lists only other destinations', () => {
      const policy = { ...base, allowPrivate: true, allowHosts: ['192.168.1.20'] };
      expect(check('http://127.0.0.1/', [v4('127.0.0.1')], policy)).toThrow(
        expect.objectContaining({ code: 'blocked_address' }),
      );
    });

    it.each([
      ['IP', 'http://127.0.0.1/', ['127.0.0.1']],
      ['CIDR', 'http://127.0.0.1/', ['127.0.0.0/8']],
      ['IPv6 IP', 'http://[::1]/', ['::1']],
      ['hostname', 'http://ollama/', ['ollama']],
    ])('is allowed by an explicit %s entry', (_kind, raw, allowHosts) => {
      const target = parseTarget(raw);
      const address = target.hostIsIp ? target.host : '127.0.0.1';
      const fam = address.includes(':') ? v6(address) : v4(address);
      expect(check(raw, [fam], { ...base, allowPrivate: true, allowHosts })).not.toThrow();
      expect(check(raw, [fam], { ...base, allowPrivate: false, allowHosts })).not.toThrow();
    });

    it('private and cgnat still open with allowPrivate and an empty allowlist', () => {
      const policy = { ...base, allowPrivate: true };
      expect(check('http://a.lan/', [v4('172.16.0.1')], policy)).not.toThrow();
      expect(check('http://a.lan/', [v4('100.64.0.1')], policy)).not.toThrow();
      expect(check('http://a.lan/', [v6('fd00::1')], policy)).not.toThrow();
    });
  });

  it('blocks when any resolved address is private', () => {
    expect(check('http://mixed.test/', [v4('8.8.8.8'), v4('10.0.0.1')], base)).toThrow(
      expect.objectContaining({ code: 'blocked_address' }),
    );
  });

  it('denyHosts IP and CIDR entries block resolved addresses', () => {
    const policy = { ...base, allowPrivate: true, denyHosts: ['10.9.0.0/16', '8.8.4.4'] };
    expect(check('http://a.test/', [v4('10.9.1.1')], policy)).toThrow(
      expect.objectContaining({ code: 'blocked_address' }),
    );
    expect(check('http://8.8.4.4/', [v4('8.8.4.4')], policy)).toThrow(
      expect.objectContaining({ code: 'blocked_address' }),
    );
  });
});
