// SPDX-License-Identifier: AGPL-3.0-only
import type { ErrorCode, ErrorDetail } from '@app/shared';

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  password_policy: 400,
  signup_closed: 403,
  invitation_required: 403,
  email_taken: 409,
  token_expired: 401,
  session_expired: 401,
  session_revoked: 401,
  refresh_race: 401,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
};

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  validation_failed: 'The request is invalid.',
  password_policy: 'The password does not meet the policy.',
  signup_closed: 'Sign-ups are closed on this instance.',
  invitation_required: 'An invitation is required to sign up.',
  email_taken: 'An account with this email address already exists.',
  token_expired: 'The access token has expired.',
  session_expired: 'Your session has expired. Please sign in again.',
  session_revoked: 'Your session is no longer valid. Please sign in again.',
  refresh_race: 'A newer session token was already issued. Retry the request.',
  unauthorized: 'Authentication is required.',
  forbidden: 'You do not have permission to do that.',
  not_found: 'Not found.',
  conflict: 'The request conflicts with the current state.',
  payload_too_large: 'The request payload is too large.',
  rate_limited: 'Too many requests. Try again later.',
  internal_error: 'An internal error occurred.',
};

export interface AppErrorOptions {
  status?: number;
  message?: string;
  details?: ErrorDetail[];
  cause?: unknown;
}

/** An error whose `code` is safe to send to a client. Unknown errors never reach a client. */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? DEFAULT_MESSAGE[code], { cause: options.cause });
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.details = options.details;
  }
}
