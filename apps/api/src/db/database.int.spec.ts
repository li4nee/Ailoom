// SPDX-License-Identifier: AGPL-3.0-only
import semver from 'semver';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../test/helpers/db';

describe('database', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await getTestDataSource();
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('has pgvector >= 0.8', async () => {
    const rows = await ds.query<{ extversion: string }[]>(
      `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
    );
    const version = semver.coerce(rows[0]?.extversion ?? '0');
    expect(version).not.toBeNull();
    expect(semver.gte(version!, '0.8.0')).toBe(true);
  });

  it('generates uuidv7 natively', async () => {
    const rows = await ds.query<{ id: string }[]>('SELECT uuidv7() AS id');
    expect(rows[0]?.id[14]).toBe('7');
  });

  it('has citext', async () => {
    expect(await ds.query(`SELECT 1 FROM pg_extension WHERE extname='citext'`)).toHaveLength(1);
  });

  it('has run the migrations once, recording them in the migrations table', async () => {
    const rows = await ds.query<{ name: string }[]>('SELECT name FROM migrations ORDER BY id');
    expect(rows.map((r) => r.name)).toContain('Extensions0000000000001');
  });
});

describe('resetDatabase', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await getTestDataSource();
    await ds.query('CREATE TABLE reset_probe (id uuid PRIMARY KEY DEFAULT uuidv7(), note text)');
    await ds.query('CREATE SCHEMA IF NOT EXISTS pgboss');
    await ds.query('CREATE TABLE pgboss.job (id uuid PRIMARY KEY DEFAULT uuidv7(), name text)');
  });

  afterAll(async () => {
    await ds.query('DROP SCHEMA pgboss CASCADE');
    await ds.query('DROP TABLE reset_probe');
    await ds.destroy();
  });

  it('empties every public table and pgboss.job but keeps the migrations table', async () => {
    await ds.query(`INSERT INTO reset_probe (note) VALUES ('a'), ('b')`);
    await ds.query(`INSERT INTO pgboss.job (name) VALUES ('job')`);

    await resetDatabase(ds);

    expect(await ds.query('SELECT 1 FROM reset_probe')).toHaveLength(0);
    expect(await ds.query('SELECT 1 FROM pgboss.job')).toHaveLength(0);
    expect(await ds.query('SELECT 1 FROM migrations')).not.toHaveLength(0);
  });

  it('works when pgboss.job does not exist', async () => {
    await ds.query('DROP TABLE pgboss.job');
    await expect(resetDatabase(ds)).resolves.toBeUndefined();
    await ds.query('CREATE TABLE pgboss.job (id uuid PRIMARY KEY DEFAULT uuidv7(), name text)');
  });
});

describe('test harness network guard', () => {
  it('blocks outbound requests to hosts that are not local', async () => {
    await expect(fetch('http://203.0.113.7/')).rejects.toThrow();
  });
});
