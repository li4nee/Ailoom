// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser, createWorkspace } from '../../../test/helpers/factories';
import { FixedClock } from '../../common/clock';
import { asWorkspaceId, type WorkspaceId } from '../../db/ids';
import { OutboxRepository } from './outbox.repository';
import { OutboxService } from './outbox.service';

const NOW = new Date('2026-01-01T00:00:00Z');
const AGGREGATE_ID = '0190b000-0000-7000-8000-000000000034';

let ds: DataSource;
let outbox: OutboxService;
let repository: OutboxRepository;
let workspaceId: WorkspaceId;

beforeAll(async () => {
  ds = await getTestDataSource();
  repository = new OutboxRepository(ds);
  outbox = new OutboxService(repository, new FixedClock(NOW));
});

afterAll(async () => {
  await ds.destroy();
});

beforeEach(async () => {
  await resetDatabase(ds);
  const { user } = await createUser({ ds }, { email: `outbox-${String(Date.now())}@example.com` });
  workspaceId = asWorkspaceId((await createWorkspace({ ds }, user, 'Outbox')).id);
});

describe('transactional integration outbox', () => {
  it('commits one event and ignores duplicate registration', async () => {
    const first = await ds.transaction((manager) =>
      outbox.record(
        workspaceId,
        {
          type: 'conversation.created',
          aggregateId: AGGREGATE_ID,
          idempotencyKey: 'conversation:one',
          data: { status: 'ai' },
        },
        manager,
      ),
    );
    const second = await ds.transaction((manager) =>
      outbox.record(
        workspaceId,
        {
          type: 'conversation.created',
          aggregateId: AGGREGATE_ID,
          idempotencyKey: 'conversation:one',
          data: { status: 'ai' },
        },
        manager,
      ),
    );

    expect(second.id).toBe(first.id);
    expect(await repository.listPending(workspaceId)).toHaveLength(1);
  });

  it('does not leave an event after the business transaction rolls back', async () => {
    await expect(
      ds.transaction(async (manager) => {
        await outbox.record(
          workspaceId,
          {
            type: 'handoff.requested',
            aggregateId: AGGREGATE_ID,
            idempotencyKey: 'handoff:one',
            data: { reason: 'visitor_requested' },
          },
          manager,
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await repository.listPending(workspaceId)).toEqual([]);
  });
});
