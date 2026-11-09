// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { beforeAll, describe, expect, it } from 'vitest';

import { EMAIL_TOKEN_TYPES, INVITATION_ROLES, ROLES } from '@app/shared';

import { getTestDataSource } from '../../test/helpers/db';

describe('identity schema', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await getTestDataSource();
  });

  const cols = (table: string): Promise<Record<string, unknown>[]> =>
    ds.query<Record<string, unknown>[]>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = $1`,
      [table],
    );

  it('creates users with citext email and token_version', async () => {
    const c = await cols('users');
    expect(c).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column_name: 'email', data_type: 'USER-DEFINED' }),
        expect.objectContaining({
          column_name: 'token_version',
          data_type: 'integer',
          column_default: '0',
        }),
        expect.objectContaining({ column_name: 'id', column_default: 'uuidv7()' }),
      ]),
    );
  });

  it('allows exactly one owner per workspace', async () => {
    const [workspace] = await ds.query<{ id: string }[]>(
      `INSERT INTO workspaces (name, slug) VALUES ('Acme', 'acme-one-owner') RETURNING id`,
    );
    const users = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, password_hash) VALUES ('owner-a@example.com', 'x'),
              ('owner-b@example.com', 'x') RETURNING id`,
    );

    await ds.query(
      `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [workspace?.id, users[0]?.id],
    );
    await expect(
      ds.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [
        workspace?.id,
        users[1]?.id,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces case-insensitive unique emails', async () => {
    await ds.query(`INSERT INTO users (email, password_hash) VALUES ('Case@Example.com', 'x')`);
    await expect(
      ds.query(`INSERT INTO users (email, password_hash) VALUES ('case@example.com', 'x')`),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('has every table from spec 9.1, 9.6 and instance tables', async () => {
    const names = (
      await ds.query<{ tablename: string }[]>(
        `SELECT tablename FROM pg_tables WHERE schemaname='public'`,
      )
    ).map((row) => row.tablename);
    expect(names).toEqual(
      expect.arrayContaining([
        'users',
        'auth_sessions',
        'email_tokens',
        'workspaces',
        'memberships',
        'invitations',
        'audit_log',
        'files',
        'instance_settings',
        'worker_heartbeats',
      ]),
    );
  });

  it.each([
    ['role', ROLES],
    ['email_token_type', EMAIL_TOKEN_TYPES],
    ['invitation_role', INVITATION_ROLES],
  ])('has a %s enum whose labels are the shared list, in order', async (name, expected) => {
    const labels = await ds.query<{ enumlabel: string }[]>(
      `SELECT e.enumlabel
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1
        ORDER BY e.enumsortorder`,
      [name],
    );
    expect(labels.map((row) => row.enumlabel)).toEqual([...expected]);
  });
});
