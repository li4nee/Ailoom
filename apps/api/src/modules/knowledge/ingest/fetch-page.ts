// SPDX-License-Identifier: AGPL-3.0-only
import {
  type FetchPolicy,
  type LookupFn,
  safeFetch,
  SafeFetchError,
} from '../../../common/safe-fetch';
import { IngestFailure } from '../errors';

/** The crawl policy, built from config; tests override it with one that allows their server. */
export const CRAWL_FETCH_POLICY = Symbol('CRAWL_FETCH_POLICY');

/** Test seam: a DNS lookup that maps a fixture host to the local HTTP server. */
export const FETCH_DEPS = Symbol('FETCH_DEPS');

export interface FetchDeps {
  lookup?: LookupFn;
}

export interface FetchedPage {
  finalUrl: string;
  contentType: string;
  body: Buffer;
}

/** The document kinds `ingest.page` can extract, from the response content type. */
export function kindOf(contentType: string): 'html' | 'text' | 'markdown' | 'pdf' | null {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (type === 'text/plain') return 'text';
  if (type === 'text/markdown' || type === 'text/x-markdown') return 'markdown';
  if (type === 'application/pdf') return 'pdf';
  return null;
}

function failureFor(error: SafeFetchError): IngestFailure {
  switch (error.code) {
    case 'blocked_address':
    case 'blocked_host':
    case 'blocked_scheme':
    case 'blocked_port':
      return new IngestFailure('blocked_url');
    case 'too_large':
      return new IngestFailure('too_large');
    case 'bad_content_type':
      return new IngestFailure('bad_content_type');
    case 'timeout':
    case 'dns_failed':
    case 'connection_failed':
    case 'too_many_redirects':
      return new IngestFailure('connection_failed');
    default:
      return new IngestFailure('connection_failed');
  }
}

/**
 * Fetches one page through `safeFetch` (spec §12.1): the crawl never inherits a provider URL
 * exception, and a private address, a redirect loop or an oversized body is a
 * `blocked_url`/`too_large` failure for this page only, not for the source.
 */
export async function fetchPage(
  url: string,
  policy: FetchPolicy,
  deps: FetchDeps = {},
): Promise<FetchedPage> {
  let response: Response;
  try {
    response = await safeFetch(url, { method: 'GET' }, policy, deps);
  } catch (error) {
    if (error instanceof SafeFetchError) throw failureFor(error);
    throw error;
  }
  if (!response.ok) throw new IngestFailure('http_error');

  const contentType = response.headers.get('content-type') ?? '';
  const body = Buffer.from(await response.arrayBuffer());
  return { finalUrl: response.url !== '' ? response.url : url, contentType, body };
}
