// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AppConfig, loadConfig } from '../../src/common/config';
import { runMigrations } from '../../src/db/cli-data-source';
import { buildDataSourceOptions } from '../../src/db/data-source';
import { createTestApp, type TestApp } from '../helpers/app';
import { getTestDataSource } from '../helpers/db';

interface HttpResult {
  status: number;
  headers: Record<string, string | undefined>;
  body: {
    status: string;
    checks: Record<string, string>;
  };
}

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'w'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
  LOG_LEVEL: 'error',
};

describe('health endpoints', () => {
  let t: TestApp;
  let ds: DataSource;
  let config: AppConfig;

  beforeAll(async () => {
    config = loadConfig(TEST_ENV);
    const testDs = await getTestDataSource();
    const databaseUrl = testDs.options.url as string;
    const testConfig = {
      ...config,
      database: { ...config.database, url: databaseUrl, listenUrl: databaseUrl },
    };
    t = await createTestApp({ config: testConfig });
    ds = t.ds;
  });

  afterAll(async () => {
    await t.close();
  });

  it('is ready on a migrated db', async () => {
    const res = await t.http.get('/api/health/ready');
    expect(res.status).toBe(200);
    const body = res.body as HttpResult['body'];
    expect(body).toMatchObject({
      status: 'ok',
      checks: {
        db: 'ok',
        migrations: 'ok',
        queue: 'ok',
        pgvector: expect.stringMatching(/^0\.(8|9)|^[1-9]/),
      },
    });
  });

  it('is not ready with pending migrations', async () => {
    // Revert the last migration to simulate pending migrations
    const cliDs = new DataSource(buildDataSourceOptions(config.database));
    await cliDs.initialize();
    await cliDs.runMigrations({ transaction: 'each' });
    await runMigrations(cliDs, { transaction: 'each' });
    await cliDs.undoLastMigration({ transaction: 'each' });
    await cliDs.destroy();

    // Create a new test app to pick up the reverted state
    const t2 = await createTestApp({
      config: {
        ...config,
        database: {
          ...config.database,
          url: ds.options.url as string,
          listenUrl: ds.options.url as string,
        },
      },
    });
    try {
      const res = await t2.http.get('/api/health/ready');
      expect(res.status).toBe(503);
      const body = res.body as HttpResult['body'];
      expect(body).toMatchObject({
        status: 'error',
        checks: expect.objectContaining({
          migrations: 'pending migrations',
        }),
      });
    } finally {
      await t2.close();
      // Re-apply the migration for other tests
      const cliDs2 = new DataSource(buildDataSourceOptions(config.database));
      await cliDs2.initialize();
      await runMigrations(cliDs2, { transaction: 'each' });
      await cliDs2.destroy();
    }
  });

  it('serves liveness', async () => {
    const res = await t.http.get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
