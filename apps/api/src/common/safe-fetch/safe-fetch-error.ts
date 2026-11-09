// SPDX-License-Identifier: AGPL-3.0-only
export type SafeFetchErrorCode =
  | 'blocked_scheme'
  | 'blocked_port'
  | 'blocked_address'
  | 'blocked_host'
  | 'dns_failed'
  | 'too_many_redirects'
  | 'too_large'
  | 'timeout'
  | 'bad_content_type'
  | 'connection_failed';

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(code: SafeFetchErrorCode, message = code) {
    super(message);
    this.code = code;
    this.name = 'SafeFetchError';
  }
}
