// SPDX-License-Identifier: AGPL-3.0-only
import * as ipaddr from 'ipaddr.js';

import { classifyIp, type IpClass } from './classify-ip';
import { normalizeHost, type ParsedTarget } from './parse-target';
import type { FetchPolicy } from './policies';
import { SafeFetchError } from './safe-fetch-error';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** No policy reaches these: neither `allowPrivate` nor `allowHosts` applies to them. */
const ALWAYS_BLOCKED: ReadonlySet<IpClass> = new Set<IpClass>([
  'link_local',
  'unspecified',
  'multicast',
  'reserved',
  'metadata',
]);

type Ip = ipaddr.IPv4 | ipaddr.IPv6;

/** Parses an address, unwrapping IPv4-mapped IPv6 so `::ffff:10.0.0.1` matches `10.0.0.0/8`. */
function toIp(address: string): Ip | null {
  try {
    return ipaddr.process(address);
  } catch {
    return null;
  }
}

interface HostList {
  names: string[];
  ips: Ip[];
  cidrs: [Ip, number][];
}

/** Splits a policy host list into hostnames, IP literals and CIDR ranges. */
function splitHostList(entries: readonly string[]): HostList {
  const list: HostList = { names: [], ips: [], cidrs: [] };
  for (const raw of entries) {
    const entry = normalizeHost(raw.trim());
    if (entry === '') continue;
    if (entry.includes('/')) {
      try {
        list.cidrs.push(ipaddr.parseCIDR(entry));
      } catch {
        // Not a CIDR: ignore rather than widen the list.
      }
      continue;
    }
    const ip = ipaddr.isValid(entry) ? toIp(entry) : null;
    if (ip !== null) list.ips.push(ip);
    else list.names.push(entry);
  }
  return list;
}

function addressInList(address: string, list: HostList): boolean {
  const ip = toIp(address);
  if (ip === null) return false;
  const text = ip.toNormalizedString();
  if (list.ips.some((entry) => entry.kind() === ip.kind() && entry.toNormalizedString() === text)) {
    return true;
  }
  return list.cidrs.some(([range, bits]) => range.kind() === ip.kind() && ip.match(range, bits));
}

/**
 * Host-name check before any DNS lookup. `denyHosts` names match the host and every
 * subdomain (`x.metadata.google.internal`), case-insensitively and ignoring a trailing dot.
 */
export function assertHostAllowed(target: ParsedTarget, policy: FetchPolicy): void {
  if (target.hostIsIp) return;
  const host = target.host;
  const denied = splitHostList(policy.denyHosts).names.some(
    (name) => host === name || host.endsWith(`.${name}`),
  );
  if (denied) throw new SafeFetchError('blocked_host');
}

/**
 * Address check on the IP literal or every resolved address, before connecting.
 *
 * - IP/CIDR entries of `denyHosts` and the always-blocked classes (link-local, unspecified,
 *   multicast, reserved, metadata) are rejected under every policy.
 * - Public addresses are allowed.
 * - Private (RFC 1918 / ULA) and CGNAT addresses need an exception: the host name or the
 *   address matches `allowHosts` (hostname, IP or CIDR). With `allowPrivate` and an empty
 *   `allowHosts`, every such address is allowed; a non-empty `allowHosts` narrows
 *   `allowPrivate` to exactly the listed destinations.
 * - Loopback (127.0.0.0/8, ::1 and their IPv4-mapped / NAT64 forms) is reachable only
 *   through an explicit `allowHosts` entry; `allowPrivate` alone never opens it, so a
 *   provider URL cannot reach services bound to the api container's own loopback.
 */
export function assertAddressesAllowed(
  target: ParsedTarget,
  addresses: readonly ResolvedAddress[],
  policy: FetchPolicy,
): void {
  const deny = splitHostList(policy.denyHosts);
  const allow = splitHostList(policy.allowHosts);
  const hostListed = !target.hostIsIp && allow.names.includes(target.host);
  const anyPrivate = policy.allowPrivate && policy.allowHosts.length === 0;

  for (const { address } of addresses) {
    if (addressInList(address, deny)) throw new SafeFetchError('blocked_address');
    const cls = classifyIp(address);
    if (ALWAYS_BLOCKED.has(cls)) throw new SafeFetchError('blocked_address');
    if (cls === 'public') continue;
    if (hostListed || addressInList(address, allow)) continue;
    if (anyPrivate && cls !== 'loopback') continue;
    throw new SafeFetchError('blocked_address');
  }
}
