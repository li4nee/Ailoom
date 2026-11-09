// SPDX-License-Identifier: AGPL-3.0-only
import ipaddr from 'ipaddr.js';

export type IpClass =
  | 'public'
  | 'private'
  | 'loopback'
  | 'link_local'
  | 'cgnat'
  | 'multicast'
  | 'reserved'
  | 'metadata'
  | 'unspecified';

const METADATA = new Set([
  '169.254.169.254',
  ipaddr.parse('fd00:ec2::254').toNormalizedString(),
  '100.100.100.200',
]);

// IPv4-compatible addresses (::a.b.c.d, deprecated by RFC 4291) share ::/96 with :: and ::1.
// Stacks that still honour them reach the embedded IPv4 host, so they are never public.
function isIpv4Compatible(addr: ipaddr.IPv6): boolean {
  const parts = addr.parts;
  const prefixZero = parts.slice(0, 6).every((p) => p === 0);
  const tail = (parts[6] ?? 0) * 0x10000 + (parts[7] ?? 0);
  return prefixZero && tail > 1;
}

function isNat64(addr: ipaddr.IPv6): boolean {
  const parts = addr.parts;
  return (
    parts[0] === 0x0064 &&
    parts[1] === 0xff9b &&
    parts[2] === 0 &&
    parts[3] === 0 &&
    parts[4] === 0 &&
    parts[5] === 0
  );
}

// ipaddr.js turns any dotted IPv6 tail into ::ffff:a.b.c.d, so `::127.0.0.1` would look
// IPv4-mapped. Rewriting the tail as two hex groups keeps the address's real bits.
function expandDottedTail(ip: string): string {
  const match = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (match === null) return ip;
  const [, head = '', ...rest] = match;
  const octets = rest.map(Number);
  if (octets.length !== 4 || octets.some((o) => o > 255)) return ip;
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return `${head}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
}

export function classifyIp(ip: string): IpClass {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(expandDottedTail(ip));
  } catch {
    return 'reserved';
  }

  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return classifyIp(v6.toIPv4Address().toString());
    if (isNat64(v6)) {
      const embedded = ipaddr.fromByteArray(v6.toByteArray().slice(12));
      return classifyIp(embedded.toString());
    }
    if (isIpv4Compatible(v6)) return 'reserved';
    const norm = v6.toNormalizedString();
    if (METADATA.has(norm)) return 'metadata';
    const range = v6.range();
    if (range === 'loopback') return 'loopback';
    if (range === 'unspecified') return 'unspecified';
    if (range === 'linkLocal') return 'link_local';
    if (range === 'uniqueLocal') return 'private';
    if (range === 'multicast') return 'multicast';
    if (range === 'unicast') return 'public';
    return 'reserved';
  }

  const v4 = addr as ipaddr.IPv4;
  const norm = v4.toString();
  if (METADATA.has(norm)) return 'metadata';
  if (norm === '255.255.255.255') return 'reserved';
  const range = v4.range();
  if (range === 'loopback') return 'loopback';
  if (range === 'unspecified') return 'unspecified';
  if (range === 'linkLocal') return 'link_local';
  if (range === 'private') return 'private';
  if (range === 'carrierGradeNat') return 'cgnat';
  if (range === 'multicast') return 'multicast';
  if (range === 'broadcast' || range === 'reserved') return 'reserved';
  if (range === 'unicast') return 'public';
  return 'reserved';
}
