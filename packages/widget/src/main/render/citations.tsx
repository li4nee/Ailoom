// SPDX-License-Identifier: MIT
import type { Citation } from '@app/shared';
import { isSafeHref } from '@app/shared';

function httpUrlOrNull(url: string | null): string | null {
  return url !== null && /^https?:\/\//i.test(url) ? url : null;
}

/**
 * The widget's stricter link rule (spec §16.2): an answer may link only to a host it actually
 * cites, plus any extra domains the server allowed. The server already applied the full policy;
 * this stops a compromised or over-broad answer from sending visitors anywhere else.
 */
export function isLinkAllowedFor(
  citations: readonly Citation[],
  allowedLinkDomains: readonly string[] = [],
): (href: string) => boolean {
  const hosts = new Set<string>();
  for (const citation of citations) {
    if (citation.url === null) continue;
    try {
      hosts.add(new URL(citation.url).hostname.toLowerCase());
    } catch {
      // A malformed stored URL never becomes an allowed host.
    }
  }
  const extra = allowedLinkDomains.map((domain) => domain.trim().toLowerCase());

  return (href) => {
    if (!isSafeHref(href)) return false;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return (
      hosts.has(host) ||
      extra.some((domain) => domain !== '' && (host === domain || host.endsWith(`.${domain}`)))
    );
  };
}

/** The numbered sources under an AI answer; file citations render as a plain title. */
export function Citations({ items }: { items: Citation[] }) {
  if (items.length === 0) return null;
  return (
    <ol class="ailoom-citations">
      {items.map((citation) => {
        const href = httpUrlOrNull(citation.url);
        return (
          <li key={`${String(citation.n)}-${citation.chunkId}`}>
            {href === null ? (
              <span>{citation.title}</span>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {citation.title}
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}
