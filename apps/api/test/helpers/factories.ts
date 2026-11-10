// SPDX-License-Identifier: AGPL-3.0-only
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
