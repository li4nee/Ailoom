// SPDX-License-Identifier: AGPL-3.0-only
import type { Test } from 'supertest';
import type { DataSource } from 'typeorm';

import { UserEntity } from '../../src/modules/auth/entities/user.entity';
import { PasswordHasher } from '../../src/modules/auth/password-hasher';

/** Anything that can reach the test database. A full `TestApp` satisfies it. */
export interface DbContext {
  ds: DataSource;
}

export interface CreateUserOptions {
  email?: string;
  password?: string;
  name?: string;
  /** Defaults to true: most tests are not about the verification flow. */
  verified?: boolean;
  isInstanceAdmin?: boolean;
}

const DEFAULT_PASSWORD = 'correct horse battery';

const hasher = new PasswordHasher();

/** The subset of a supertest client that `authed` wraps; each call sends the session cookies. */
export interface AuthedClient {
  get(path: string): Test;
  post(path: string): Test;
  patch(path: string): Test;
  delete(path: string): Test;
}

export interface CookieResponse {
  headers: { 'set-cookie'?: string[] | string };
}

/** The `Set-Cookie` values from a response, whether the adapter sent one string or an array. */
export function setCookies(response: CookieResponse): string[] {
  const header = response.headers['set-cookie'];
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

/** The `name=value` part of the first cookie called `name`, for a request `Cookie` header. */
export function cookieValue(cookies: string[], name: string): string {
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  if (cookie === undefined) throw new Error(`no ${name} cookie in ${cookies.join(', ')}`);
  return cookie.split(';')[0] ?? cookie;
}

/**
 * Inserts a user directly, bypassing signup (and its email): tests that only need an account
 * should not depend on the flow under test in another task. Returns the password it used.
 */
export async function createUser(
  t: DbContext,
  options: CreateUserOptions = {},
): Promise<{ user: UserEntity; password: string }> {
  const password = options.password ?? DEFAULT_PASSWORD;
  const passwordHash = await hasher.hash(password);
  const repository = t.ds.getRepository(UserEntity);
  const result = await repository.insert({
    email: options.email ?? 'user@example.com',
    passwordHash,
    name: options.name ?? null,
    emailVerifiedAt: options.verified === false ? null : new Date(),
    isInstanceAdmin: options.isInstanceAdmin ?? false,
  });
  const generated: unknown = (result.identifiers[0] as Record<string, unknown> | undefined)?.['id'];
  if (typeof generated !== 'string') throw new Error('createUser: insert returned no id');
  return { user: await repository.findOneByOrFail({ id: generated }), password };
}

/**
 * Logs in through the real endpoint and returns its `Set-Cookie` values (access + refresh).
 * The caller passes them to `authed`, which replays exactly the cookies a browser would hold.
 */
export async function loginAs(
  t: { http: { post(path: string): Test }; config: { publicUrl: URL } },
  user: { email: string },
  password: string,
): Promise<string[]> {
  const response = await t.http
    .post('/api/v1/auth/login')
    .set({ 'X-Requested-With': 'fetch', Origin: t.config.publicUrl.origin })
    .send({ email: user.email, password });
  if (response.status !== 200) {
    throw new Error(`loginAs failed with ${String(response.status)}: ${response.text}`);
  }
  return setCookies(response);
}

/**
 * A client that sends the given session cookies plus the headers a same-origin fetch sends
 * (CSRF checks arrive in Task 1.7; sending them now keeps every test honest).
 */
export function authed(
  t: {
    http: {
      get(path: string): Test;
      post(path: string): Test;
      patch(path: string): Test;
      delete(path: string): Test;
    };
    config: { publicUrl: URL };
  },
  cookies: string[],
): AuthedClient {
  const cookie = cookies.map((value) => value.split(';')[0]).join('; ');
  const defaults = {
    Cookie: cookie,
    'X-Requested-With': 'fetch',
    Origin: t.config.publicUrl.origin,
  };
  const apply = (request: Test): Test => request.set(defaults);
  return {
    get: (path) => apply(t.http.get(path)),
    post: (path) => apply(t.http.post(path)),
    patch: (path) => apply(t.http.patch(path)),
    delete: (path) => apply(t.http.delete(path)),
  };
}
