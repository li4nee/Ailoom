// SPDX-License-Identifier: AGPL-3.0-only
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';
import { loadMigrations, testDataSourceOptions } from '../helpers/db';

let t: TestApp;
/** Runs migrations against the shared test database, like `pnpm db:migrate` would. */
let migrator: DataSource;

beforeAll(async () => {
  t = await createTestApp();
  migrator = await new DataSource(
    testDataSourceOptions(inject('databaseUrl'), {
      entities: [],
      migrations: await loadMigrations(),
    }),
  ).initialize();
});

afterAll(async () => {
  // Leave the shared database fully migrated for the files that run after this one.
  await migrator.runMigrations({ transaction: 'each' });
  await migrator.destroy();
  await t.close();
});

describe('GET /api/health/ready', () => {
  it('is ready on a migrated db', async () => {
    const res = await t.http.get('/api/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      checks: {
        db: 'ok',
        migrations: 'ok',
        queue: 'ok',
        pgvector: expect.stringMatching(/^0\.(8|9)|^[1-9]/) as unknown,
      },
    });
  });

  it('is not ready with pending migrations', async () => {
    await migrator.undoLastMigration({ transaction: 'each' });

    const res = await t.http.get('/api/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'error',
      checks: { db: 'ok', migrations: 'pending migrations', queue: 'ok' },
    });
  });
});

describe('GET /api/health/live', () => {
  it('serves liveness', async () => {
    const res = await t.http.get('/api/health/live');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
