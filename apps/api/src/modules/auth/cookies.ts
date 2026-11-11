// SPDX-License-Identifier: AGPL-3.0-only
import type { AppConfig } from '../../common/config';

/** Spec §10.1: `__Host-` forces Secure, Path=/ and no Domain; browsers enforce it. */
export const ACCESS_COOKIE = '__Host-at';

/** Scoped to the refresh endpoint, so it is not sent with ordinary API calls. */
export const REFRESH_COOKIE = '__Secure-rt';

export const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

/** Reads one `name=value` pair. Returns undefined rather than throwing on malformed headers. */
export function readCookie(
  header: string | string[] | undefined,
  name: string,
): string | undefined {
  if (header === undefined) return undefined;
  const text = Array.isArray(header) ? header.join(';') : header;
  for (const part of text.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

const DAY_SECONDS = 86_400;
const MINUTE_SECONDS = 60;

/**
 * Both cookies a successful login/refresh sets. Attribute order is part of the contract the
 * admin client and the e2e tests assert: HttpOnly, Secure, SameSite, Path, Max-Age.
 */
export function sessionCookies(tokens: SessionTokens, config: AppConfig): string[] {
  const accessMaxAge = config.auth.accessTokenTtlMin * MINUTE_SECONDS;
  const refreshMaxAge = config.auth.refreshTokenTtlDays * DAY_SECONDS;
  return [
    `${ACCESS_COOKIE}=${tokens.accessToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${String(accessMaxAge)}`,
    `${REFRESH_COOKIE}=${tokens.refreshToken}; HttpOnly; Secure; SameSite=Strict; Path=${REFRESH_COOKIE_PATH}; Max-Age=${String(refreshMaxAge)}`,
  ];
}

/** Logout responses: same names and paths, expired immediately. */
export function clearedCookies(): string[] {
  return [
    `${ACCESS_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    `${REFRESH_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=${REFRESH_COOKIE_PATH}; Max-Age=0`,
  ];
}
