// SPDX-License-Identifier: MIT

export type HostMatcher = (host: string) => boolean;
export interface AllowedLinkHostsInput {
  usedSourceUrls: (string | null)[];
  allowedOrigins: string[];
  allowedLinkDomains: string[];
}

function hostOf(value: string): string {
  const input = value.trim().toLowerCase();
  if (input.startsWith('*.')) return input.slice(2);
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return input.split('/')[0]?.split(':')[0] ?? input;
  }
}

export function buildAllowedLinkHosts(input: AllowedLinkHostsInput): HostMatcher {
  const exact = new Set<string>();
  const wildcards = new Set<string>();
  const add = (value: string): void => {
    if (value.trim() === '') return;
    const host = hostOf(value);
    if (value.trim().startsWith('*.')) wildcards.add(host);
    else exact.add(host);
  };
  for (const source of input.usedSourceUrls) {
    if (source === null) continue;
    try {
      exact.add(new URL(source).hostname.toLowerCase());
    } catch {
      // Malformed source URLs cannot authorize links.
    }
  }
  for (const origin of input.allowedOrigins) add(origin);
  for (const domain of input.allowedLinkDomains) add(domain);
  return (host) => {
    const candidate = host.toLowerCase();
    if (exact.has(candidate)) return true;
    for (const domain of wildcards) {
      if (candidate === domain || candidate.endsWith(`.${domain}`)) return true;
    }
    return false;
  };
}

function allowed(url: string, hosts: HostMatcher): boolean {
  if (url.toLowerCase().startsWith('mailto:')) return true;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && hosts(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Removes images and turns disallowed links into plain text. A URL may contain one balanced
 * `(…)` group; the trailing run is only allowed after that group so the pattern stays linear
 * on long unclosed targets in model output.
 */
export function applyLinkPolicy(markdown: string, hosts: HostMatcher): string {
  const withoutImages = markdown.replace(/!\[[^\]]*\]\([^()\s]*(?:\([^()]*\)[^()\s]*)?\)/g, '');
  const linked = withoutImages.replace(
    /(?<!!)\[([^\]]*)\]\(([^()\s]*(?:\([^()]*\)[^()\s]*)?)\)/g,
    (match, label: string, url: string) => (allowed(url, hosts) ? match : label),
  );
  return linked.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/gi, (match, url: string) =>
    allowed(url, hosts) ? match : `\`${url}\``,
  );
}
