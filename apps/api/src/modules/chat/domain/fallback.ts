// SPDX-License-Identifier: AGPL-3.0-only
import type { ProviderErrorCode } from '@app/shared';

import { ProviderError } from '../../../providers';

export const FAILOVER_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  'rate_limited',
  'quota_exceeded',
  'timeout',
  'connection_failed',
  'provider_error',
  'local_model_unavailable',
  'auth_failed',
  'model_not_found',
]);

/** Retry the secondary model only for a normalized provider failure before any visitor text. */
export function shouldFailOver(
  error: unknown,
  streamed: boolean,
  signal: AbortSignal,
): error is ProviderError {
  return (
    error instanceof ProviderError && FAILOVER_CODES.has(error.code) && !streamed && !signal.aborted
  );
}
