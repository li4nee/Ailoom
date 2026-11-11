// SPDX-License-Identifier: AGPL-3.0-only
import { strings } from '@/strings';
import type { ErrorCode } from '@app/shared';

import { ApiError } from './api-error';

/**
 * The message to show for a failed call. `known` maps the codes a screen expects to its own
 * wording; anything else gets the generic text (the server's message is for logs, not users).
 */
export function errorMessage(
  error: unknown,
  known: Partial<Record<ErrorCode, string>> = {},
): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof ApiError) return known[error.code] ?? strings.app.genericError;
  return strings.app.genericError;
}

/** The ApiError code, or null for anything else. */
export function errorCode(error: unknown): ErrorCode | null {
  return error instanceof ApiError ? error.code : null;
}
