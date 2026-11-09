// SPDX-License-Identifier: AGPL-3.0-only
import { APICallError, LoadAPIKeyError, NoSuchModelError, RetryError } from 'ai';

import type { ProviderErrorCode } from '@app/shared';

import { SafeFetchError, type SafeFetchErrorCode } from '../common/safe-fetch';

const SAFE_MESSAGES: Record<ProviderErrorCode, string> = {
  auth_failed: 'The provider rejected the credential.',
  rate_limited: 'The provider is rate limiting requests.',
  quota_exceeded: 'The provider quota for this credential is exhausted.',
  model_not_found: 'The provider does not offer this model.',
  timeout: 'The provider did not respond in time.',
  aborted: 'The request was cancelled.',
  connection_failed: 'Could not connect to the provider.',
  blocked_url: 'The provider URL is not allowed.',
  local_model_unavailable: 'The local model is not available.',
  provider_error: 'The provider returned an error.',
};

/**
 * A normalized provider failure. `safeMessage` (and `message`) are fixed per code: raw
 * response bodies, URLs and causes are deliberately not kept, so logging or storing this
 * error cannot leak provider output or credentials.
 */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly code: ProviderErrorCode;
  /** The provider's HTTP status, when the failure came from an HTTP response. */
  readonly status: number | null;
  readonly safeMessage: string;

  constructor(code: ProviderErrorCode, options: { status?: number | null } = {}) {
    const safeMessage = SAFE_MESSAGES[code];
    super(safeMessage);
    this.code = code;
    this.status = options.status ?? null;
    this.safeMessage = safeMessage;
  }
}

const QUOTA_BODY = /insufficient_quota|quota_exceeded|exceeded your current quota/i;

function fromSafeFetch(code: SafeFetchErrorCode): ProviderErrorCode {
  switch (code) {
    case 'blocked_address':
    case 'blocked_host':
    case 'blocked_scheme':
    case 'blocked_port':
      return 'blocked_url';
    case 'timeout':
      return 'timeout';
    case 'dns_failed':
    case 'connection_failed':
      return 'connection_failed';
    case 'too_large':
    case 'bad_content_type':
    case 'too_many_redirects':
      return 'provider_error';
    default:
      return assertNever(code);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}

function fromStatus(status: number, body: string | undefined): ProviderErrorCode {
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 404) return 'model_not_found';
  if (status === 408) return 'timeout';
  if (status === 429) {
    return body !== undefined && QUOTA_BODY.test(body) ? 'quota_exceeded' : 'rate_limited';
  }
  return 'provider_error';
}

function errorName(e: unknown): string | undefined {
  return e instanceof Error || e instanceof DOMException ? e.name : undefined;
}

/** Maps any failure of a model call to a `ProviderError`. The single place raw errors are read. */
export function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (RetryError.isInstance(e)) return toProviderError(e.lastError);
  if (APICallError.isInstance(e)) {
    if (e.statusCode !== undefined) {
      return new ProviderError(fromStatus(e.statusCode, e.responseBody), { status: e.statusCode });
    }
    // No response: the request itself failed (blocked, DNS, connect, abort).
    return e.cause === undefined
      ? new ProviderError('connection_failed')
      : toProviderError(e.cause);
  }
  if (e instanceof SafeFetchError) return new ProviderError(fromSafeFetch(e.code));
  if (LoadAPIKeyError.isInstance(e)) return new ProviderError('auth_failed');
  if (NoSuchModelError.isInstance(e)) return new ProviderError('model_not_found');
  const name = errorName(e);
  if (name === 'TimeoutError') return new ProviderError('timeout');
  if (name === 'AbortError') return new ProviderError('aborted');
  return new ProviderError('provider_error');
}
