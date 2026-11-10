// SPDX-License-Identifier: AGPL-3.0-only
export interface IpRequest {
  headers: Record<string, unknown>;
  socket?: { remoteAddress?: string | null };
}

/** `::ffff:127.0.0.1` and `127.0.0.1` are the same client. */
function normalize(address: string): string {
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

/**
 * The client address behind Caddy, the single trusted proxy hop (global-constraints): the
 * last `X-Forwarded-For` entry is the one Caddy appended, so an attacker-supplied prefix
 * cannot choose their bucket. Without the header (tests, direct calls) the socket peer is used.
 */
export function clientIp(request: IpRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const text = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  if (typeof text === 'string') {
    const hops = text
      .split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    const last = hops.at(-1);
    if (last !== undefined) return normalize(last);
  }
  return normalize(request.socket?.remoteAddress ?? 'unknown');
}
