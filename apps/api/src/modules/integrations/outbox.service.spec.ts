// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/clock';
import type { RecordIntegrationEventInput } from './integration-events';
import { OutboxService } from './outbox.service';

const WORKSPACE_ID = '0190b000-0000-7000-8000-000000000023' as never;
const AGGREGATE_ID = '0190b000-0000-7000-8000-000000000024';
const NOW = new Date('2026-01-01T00:00:00Z');
const manager = { queryRunner: { isTransactionActive: true } } as never;

function makeService(existing: object | null = null) {
  const outbox = {
    findByIdempotencyKey: vi.fn().mockResolvedValue(existing),
    insertEvent: vi
      .fn()
      .mockImplementation(
        (
          _workspace: unknown,
          id: string,
          input: RecordIntegrationEventInput,
          occurredAt: Date,
          data: unknown,
        ) =>
          Promise.resolve({
            id,
            workspaceId: WORKSPACE_ID,
            type: input.type,
            aggregateId: input.aggregateId,
            occurredAt,
            data,
          }),
      ),
  };
  return { service: new OutboxService(outbox as never, new FixedClock(NOW)), outbox };
}

describe('OutboxService', () => {
  it('writes a versioned minimal envelope and is idempotent', async () => {
    const { service, outbox } = makeService();
    const input = {
      type: 'message.created' as const,
      aggregateId: AGGREGATE_ID,
      idempotencyKey: 'message:one',
      data: { conversationId: AGGREGATE_ID, messageId: AGGREGATE_ID, role: 'visitor' },
    };

    const first = await service.record(WORKSPACE_ID, input, manager);
    outbox.findByIdempotencyKey.mockResolvedValueOnce(first);
    const second = await service.record(WORKSPACE_ID, input, manager);

    expect(first).toMatchObject({
      type: 'message.created',
      workspaceId: WORKSPACE_ID,
      aggregateId: AGGREGATE_ID,
      version: 1,
    });
    expect(second.id).toBe(first.id);
    expect(outbox.insertEvent).toHaveBeenCalledTimes(1);
  });

  it('refuses writes outside a transaction', async () => {
    const { service } = makeService();

    await expect(
      service.record(
        WORKSPACE_ID,
        {
          type: 'contact.updated',
          aggregateId: AGGREGATE_ID,
          idempotencyKey: 'contact:one',
          data: {},
        },
        { queryRunner: { isTransactionActive: false } } as never,
      ),
    ).rejects.toMatchObject({ code: 'internal_error' });
  });
});
