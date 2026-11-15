// SPDX-License-Identifier: AGPL-3.0-only
import type { ErrorCode, ErrorDetail } from '@app/shared';

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  password_policy: 400,
  signup_closed: 403,
  invitation_required: 403,
  email_taken: 409,
  invalid_credentials: 401,
  token_expired: 401,
  session_expired: 401,
  session_revoked: 401,
  refresh_race: 401,
  csrf_failed: 403,
  invalid_token: 400,
  sole_owner: 409,
  cannot_modify_owner: 403,
  email_not_verified: 403,
  credential_in_use: 409,
  credential_builtin: 409,
  embeddings_not_supported: 400,
  reembed_not_available: 409,
  blocked_url: 400,
  unsupported_file_type: 415,
  answer_in_progress: 409,
  conversation_full: 409,
  bot_unavailable: 503,
  message_too_long: 400,
  handoff_disabled: 409,
  origin_not_allowed: 403,
  bot_not_found: 404,
  challenge_required: 403,
  challenge_invalid: 403,
  challenge_not_configured: 400,
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
  invalid_credentials: 'Email or password is incorrect.',
  token_expired: 'The access token has expired.',
  session_expired: 'Your session has expired. Please sign in again.',
  session_revoked: 'Your session is no longer valid. Please sign in again.',
  refresh_race: 'A newer session token was already issued. Retry the request.',
  csrf_failed: 'The request did not come from the application.',
  invalid_token: 'This link is invalid or has expired.',
  sole_owner: 'You are the only owner of a workspace. Transfer ownership first.',
  cannot_modify_owner: 'The workspace owner cannot be changed here.',
  email_not_verified: 'Verify your email address to continue.',
  credential_in_use: 'A bot still uses this credential. Delete or switch the bot first.',
  credential_builtin: 'The built-in credential cannot be changed or deleted.',
  embeddings_not_supported: 'This provider does not offer embeddings. Pick another credential.',
  reembed_not_available:
    'This bot already has knowledge, so its embedding model cannot change yet.',
  blocked_url: 'This address cannot be fetched. Use a public http(s) URL.',
  unsupported_file_type: 'Only PDF, Word, HTML, Markdown and text files are supported.',
  answer_in_progress: 'The bot is still answering the previous message. Please wait.',
  conversation_full: 'This conversation has reached its message limit. Please start a new one.',
  bot_unavailable: 'This support bot is no longer available.',
  message_too_long: 'The message is too long.',
  handoff_disabled: 'Handoff to a person is disabled for this bot.',
  origin_not_allowed: 'This site may not embed this bot.',
  bot_not_found: 'This support bot is no longer available.',
  challenge_required: 'A proof-of-work challenge is required.',
  challenge_invalid: 'The proof-of-work solution is invalid or expired.',
  challenge_not_configured: 'This instance does not have CHALLENGE_SECRET configured.',
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
