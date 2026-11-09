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

export function classifyIp(ip: string): IpClass {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
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
