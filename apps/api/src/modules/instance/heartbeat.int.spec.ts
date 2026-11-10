// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { FixedClock } from '../../common/clock';
import { type AppConfig, loadConfig } from '../../common/config';
import { HeartbeatService } from './heartbeat.service';

let ds: DataSource;
let config: AppConfig;
const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));

async function heartbeats(): Promise<{ worker_id: string; last_beat_at: Date; version: string }[]> {
  return ds.query('SELECT worker_id, last_beat_at, version FROM worker_heartbeats');
}

beforeAll(async () => {
  ds = await getTestDataSource();
  config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgres://app:app@localhost:5432/app',
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
  });
});

beforeEach(async () => {
  await resetDatabase(ds);
  clock.set(new Date('2026-01-01T00:00:00Z'));
});

describe('HeartbeatService', () => {
  it('writes a heartbeat', async () => {
    const hb = new HeartbeatService(ds, clock, config);
    await hb.beat();

    const rows = await heartbeats();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.last_beat_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(rows[0]?.version).toBe(config.version);
    expect(rows[0]?.worker_id).toBe(hb.workerId);
  });

  it('updates its own row on later beats', async () => {
    const hb = new HeartbeatService(ds, clock, config);
    await hb.beat();
    clock.advance(30_000);
    await hb.beat();

    const rows = await heartbeats();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.last_beat_at.toISOString()).toBe('2026-01-01T00:00:30.000Z');
  });
});
