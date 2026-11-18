// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { IntegrationEventEntity } from './integration-event.entity';
import type { RecordIntegrationEventInput } from './integration-events';

@Injectable()
export class OutboxRepository extends TenantRepository<IntegrationEventEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(IntegrationEventEntity));
  }

  async findByIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
    manager?: EntityManager,
  ): Promise<IntegrationEventEntity | null> {
    return (manager ?? this.ds).getRepository(IntegrationEventEntity).findOne({
      where: { workspaceId, idempotencyKey },
    });
  }

  async insertEvent(
    workspaceId: WorkspaceId,
    id: string,
    input: RecordIntegrationEventInput,
    occurredAt: Date,
    data: unknown,
    manager?: EntityManager,
  ): Promise<IntegrationEventEntity> {
    return this.insert(
      workspaceId,
      {
        id,
        type: input.type,
        aggregateId: input.aggregateId,
        idempotencyKey: input.idempotencyKey,
        data,
        occurredAt,
        attempts: 0,
        leasedUntil: null,
        leaseOwner: null,
        dispatchedAt: null,
      },
      manager,
    );
  }

  async claimBatch(
    limit: number,
    leaseOwner: string,
    now: Date,
    leaseMs: number,
  ): Promise<IntegrationEventEntity[]> {
    return this.ds.query<IntegrationEventEntity[]>(
      `
      WITH candidates AS (
        SELECT id
          FROM integration_events
         WHERE dispatched_at IS NULL
           AND (leased_until IS NULL OR leased_until <= $1)
         ORDER BY occurred_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $2
      )
      UPDATE integration_events event
         SET leased_until = $3, lease_owner = $4, attempts = event.attempts + 1
        FROM candidates
       WHERE event.id = candidates.id
      RETURNING event.*
      `,
      [now, limit, new Date(now.getTime() + leaseMs), leaseOwner],
    );
  }

  async markDispatched(id: string, leaseOwner: string, now: Date): Promise<void> {
    await this.ds.query(
      `UPDATE integration_events
          SET dispatched_at = $3, leased_until = NULL, lease_owner = NULL
        WHERE id = $1 AND lease_owner = $2 AND dispatched_at IS NULL`,
      [id, leaseOwner, now],
    );
  }

  async releaseLease(id: string, leaseOwner: string): Promise<void> {
    await this.ds.query(
      `UPDATE integration_events
          SET leased_until = NULL, lease_owner = NULL
        WHERE id = $1 AND lease_owner = $2 AND dispatched_at IS NULL`,
      [id, leaseOwner],
    );
  }

  async listPending(workspaceId: WorkspaceId): Promise<IntegrationEventEntity[]> {
    return this.ds.getRepository(IntegrationEventEntity).find({
      where: { workspaceId, dispatchedAt: IsNull() },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });
  }
}
