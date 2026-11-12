// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import type { RealtimeEvent } from '@app/shared';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser, createWorkspace } from '../../../test/helpers/factories';
import { loadConfig } from '../../common/config';
import type { WorkspaceId } from '../../db/ids';
import { notifyWorkspace } from './notify';
import { RealtimeHub } from './realtime-hub';

const BOT_A = '00000000-0000-7000-8000-00000000000a';
const BOT_B = '00000000-0000-7000-8000-00000000000b';

let ds: DataSource;
let hub: RealtimeHub;
let wsA: WorkspaceId;
let wsB: WorkspaceId;

function config() {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://support.example.com',
    DATABASE_URL: inject('databaseUrl'),
    DATABASE_LISTEN_URL: inject('databaseUrl'),
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
  });
}

function sourceEvent(botId: string): RealtimeEvent {
  return {
    type: 'source.updated',
    sourceId: '00000000-0000-7000-8000-000000000001',
    botId,
    status: 'ready',
  };
}

/** Waits for the initial `resync`, i.e. until this connection has issued its `LISTEN`. */
async function waitForListening(events: RealtimeEvent[]): Promise<void> {
  await vi.waitFor(
    () => {
      expect(events).toContainEqual({ type: 'resync' });
    },
    { timeout: 10_000 },
  );
  events.length = 0;
}

beforeAll(async () => {
  ds = await getTestDataSource();
});

beforeEach(async () => {
  await resetDatabase(ds);
  const { user } = await createUser({ ds }, { email: 'owner@example.com' });
  wsA = (await createWorkspace({ ds }, user, 'Acme')).id as WorkspaceId;
  wsB = (await createWorkspace({ ds }, user, 'Globex')).id as WorkspaceId;
  hub = new RealtimeHub(config());
});

afterEach(async () => {
  await hub.onApplicationShutdown();
});

describe('RealtimeHub', () => {
  it('delivers notifications committed in a transaction', async () => {
    const got: RealtimeEvent[] = [];
    hub.subscribe(
      wsA,
      () => true,
      (event) => got.push(event),
    );
    await waitForListening(got);

    await ds.transaction((manager) => notifyWorkspace(manager, wsA, sourceEvent(BOT_A)));

    await vi.waitFor(() => {
      expect(got).toEqual([expect.objectContaining({ type: 'source.updated', botId: BOT_A })]);
    });
  });

  it('drops notifications from rolled-back transactions', async () => {
    const got: RealtimeEvent[] = [];
    hub.subscribe(
      wsA,
      () => true,
      (event) => got.push(event),
    );
    await waitForListening(got);

    await ds
      .transaction(async (manager) => {
        await notifyWorkspace(manager, wsA, sourceEvent(BOT_A));
        throw new Error('rollback');
      })
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(got).toEqual([]);
  });

  it('isolates workspaces', async () => {
    const got: RealtimeEvent[] = [];
    hub.subscribe(
      wsB,
      () => true,
      (event) => got.push(event),
    );
    await waitForListening(got);

    await ds.transaction((manager) => notifyWorkspace(manager, wsA, sourceEvent(BOT_A)));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(got).toEqual([]);

    await ds.transaction((manager) => notifyWorkspace(manager, wsB, sourceEvent(BOT_B)));
    await vi.waitFor(() => {
      expect(got).toHaveLength(1);
    });
    const [event] = got;
    if (event?.type !== 'source.updated') throw new Error('expected source.updated');
    expect(event.botId).toBe(BOT_B);
  });

  it('only calls subscribers whose filter matches', async () => {
    const all: RealtimeEvent[] = [];
    const onlyB: RealtimeEvent[] = [];
    hub.subscribe(
      wsA,
      () => true,
      (event) => all.push(event),
    );
    hub.subscribe(
      wsA,
      (event) => event.type === 'source.updated' && event.botId === BOT_B,
      (event) => onlyB.push(event),
    );
    await waitForListening(all);

    await ds.transaction((manager) => notifyWorkspace(manager, wsA, sourceEvent(BOT_A)));

    await vi.waitFor(() => {
      expect(all).toHaveLength(1);
    });
    expect(onlyB).toEqual([]);
  });

  it('reconnects and emits resync after the connection is killed', async () => {
    const got: RealtimeEvent[] = [];
    hub.subscribe(
      wsA,
      () => true,
      (event) => got.push(event),
    );
    await waitForListening(got);

    await ds.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query ILIKE 'LISTEN%'",
    );

    await vi.waitFor(
      () => {
        expect(got).toContainEqual({ type: 'resync' });
      },
      { timeout: 10_000 },
    );
    got.length = 0;

    await ds.transaction((manager) => notifyWorkspace(manager, wsA, sourceEvent(BOT_A)));
    await vi.waitFor(() => {
      expect(got).toHaveLength(1);
    });
  });

  it('rejects oversized payloads', async () => {
    const event: RealtimeEvent = {
      type: 'source.updated',
      sourceId: 'x'.repeat(8000),
      botId: BOT_A,
      status: 'ready',
    };

    await expect(ds.transaction((manager) => notifyWorkspace(manager, wsA, event))).rejects.toThrow(
      /notification limit/,
    );
  });
});
