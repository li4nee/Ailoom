// SPDX-License-Identifier: AGPL-3.0-only

/** Whether a host may appear in a clickable link (lowercase, no port). */
export type HostMatcher = (host: string) => boolean;

export interface AllowedLinkHostsInput {
  /** URLs of the sources used in the answer (spec §13.6a). */
  usedSourceUrls: (string | null)[];
  /** The bot's `allowed_origins` patterns (spec §13.6b). */
  allowedOrigins: string[];
  /** The bot's `allowed_link_domains` patterns (spec §13.6c). */
  allowedLinkDomains: string[];
}

/** A URL or host pattern; `*.example.com` covers subdomains. */
function patternHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('*.')) return trimmed.slice(2);
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    // Not a URL: treat it as a bare host, dropping any path and port.
    return trimmed.split('/')[0]?.split(':')[0] ?? trimmed;
  }
}

function isWildcard(value: string): boolean {
  return value.trim().startsWith('*.');
}

/**
 * The link policy of spec §13.6: a host is allowed when it is the host of a source used in the
 * answer, an allowed origin of the bot, or one of its allowed link domains. `*.domain` patterns
 * cover the domain and its subdomains.
 */
export function buildAllowedLinkHosts(input: AllowedLinkHostsInput): HostMatcher {
  const exact = new Set<string>();
  const wildcards = new Set<string>();

  const add = (value: string): void => {
    if (value.trim() === '') return;
    const host = patternHost(value);
    if (host === '') return;
    if (isWildcard(value)) wildcards.add(host);
    else exact.add(host);
  };

  for (const url of input.usedSourceUrls) {
    if (url === null) continue;
    try {
      exact.add(new URL(url).hostname.toLowerCase());
    } catch {
      // A stored source URL that does not parse cannot authorize a link.
    }
  }
  for (const origin of input.allowedOrigins) add(origin);
  for (const domain of input.allowedLinkDomains) add(domain);

  return (host: string): boolean => {
    const candidate = host.toLowerCase();
    if (exact.has(candidate)) return true;
    for (const domain of wildcards) {
      if (candidate === domain || candidate.endsWith(`.${domain}`)) return true;
    }
    return false;
  };
}

function isAllowedUrl(url: string, isAllowed: HostMatcher): boolean {
  if (url.toLowerCase().startsWith('mailto:')) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return isAllowed(parsed.hostname);
}

const IMAGE = /!\[[^\]]*\]\([^()\s]*(?:\([^()]*\))?[^()\s]*\)/g;
const LINK = /(?<!!)\[([^\]]*)\]\(([^()\s]*(?:\([^()]*\))?[^()\s]*)\)/g;
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^>\s]+)>/gi;

/**
 * Applies the answer link policy (spec §13.6) to Markdown: images are removed, a link to an
 * unknown host (or a non-http(s), non-mailto scheme) becomes its plain text, and a disallowed
 * autolink becomes backticked text. Everything else is left exactly as written.
 */
export function applyLinkPolicy(markdown: string, isAllowed: HostMatcher): string {
  const withoutImages = markdown.replace(IMAGE, '');
  const withLinks = withoutImages.replace(LINK, (match, label: string, url: string) =>
    isAllowedUrl(url, isAllowed) ? match : label,
  );
  return withLinks.replace(AUTOLINK, (match, url: string) =>
    isAllowedUrl(url, isAllowed) ? match : `\`${url}\``,
  );
}
