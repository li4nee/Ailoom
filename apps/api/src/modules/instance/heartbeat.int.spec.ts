// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../../../test/helpers/app';
import { resetDatabase, getTestDataSource } from '../../../test/helpers/db';
import { FixedClock } from '../../common/clock';
import { type AppConfig, loadConfig } from '../../common/config';

let t: Awaited<ReturnType<typeof createTestApp>>;
let ds: DataSource;
let clock: FixedClock;
let config: AppConfig;

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'w'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
  LOG_LEVEL: 'error',
};

beforeAll(async () => {
  config = loadConfig(TEST_ENV);
  clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
  const testDs = await getTestDataSource();
  const databaseUrl = testDs.options.url as string;
  const testConfig = {
    ...config,
    database: { ...config.database, url: databaseUrl, listenUrl: databaseUrl },
  };
  t = await createTestApp({ config: { clock, ...testConfig } });
  ds = t.ds;
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
  clock.set(new Date('2026-01-01T00:00:00Z'));
});

describe('HeartbeatService', () => {
  it('writes a heartbeat', async () => {
    const { HeartbeatService } = await import('./heartbeat.service');

    const hb = new HeartbeatService(ds, clock, config);
    await hb.beat();

    const rows = await ds.query<{ last_beat_at: Date }[]>(
      `SELECT last_beat_at FROM worker_heartbeats`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].last_beat_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('upserts on subsequent beats', async () => {
    const { HeartbeatService } = await import('./heartbeat.service');

    const hb = new HeartbeatService(ds, clock, config);
    await hb.beat();
    clock.set(new Date('2026-01-01T00:00:30Z'));
    await hb.beat();

    const rows = await ds.query<{ last_beat_at: Date }[]>(
      `SELECT last_beat_at FROM worker_heartbeats`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].last_beat_at.toISOString()).toBe('2026-01-01T00:00:30.000Z');
  });
});
