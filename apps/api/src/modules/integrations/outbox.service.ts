// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { newId } from '../../common/ids';
import type { WorkspaceId } from '../../db/ids';
import {
  integrationEventEnvelopeSchema,
  type IntegrationEventEnvelope,
  type RecordIntegrationEventInput,
} from './integration-events';
import { OutboxRepository } from './outbox.repository';

/** Writes minimal, versioned events inside the business transaction that caused them. */
@Injectable()
export class OutboxService {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly clock: Clock,
  ) {}

  async record(
    workspaceId: WorkspaceId,
    input: RecordIntegrationEventInput,
    manager: EntityManager,
  ): Promise<IntegrationEventEnvelope> {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new AppError('internal_error', {
        message: 'Integration events must be written inside the business transaction.',
      });
    }
    const occurredAt = input.occurredAt ?? this.clock.now();
    const existing = await this.outbox.findByIdempotencyKey(
      workspaceId,
      input.idempotencyKey,
      manager,
    );
    if (existing !== null) return this.toEnvelope(existing);

    const id = newId();
    const data = input.data;
    const envelope = integrationEventEnvelopeSchema.parse({
      id,
      type: input.type,
      workspaceId,
      aggregateId: input.aggregateId,
      occurredAt: occurredAt.toISOString(),
      version: 1,
      data,
    });
    try {
      await this.outbox.insertEvent(workspaceId, id, input, occurredAt, envelope.data, manager);
    } catch (error) {
      // A concurrent transaction may have won the unique idempotency key race. Re-read on the
      // same transaction when possible; the caller's transaction will still decide visibility.
      const raced = await this.outbox.findByIdempotencyKey(
        workspaceId,
        input.idempotencyKey,
        manager,
      );
      if (raced === null) throw error;
      return this.toEnvelope(raced);
    }
    return envelope;
  }

  private toEnvelope(row: {
    id: string;
    type: IntegrationEventEnvelope['type'];
    workspaceId: string;
    aggregateId: string;
    occurredAt: Date | string;
    data: unknown;
  }): IntegrationEventEnvelope {
    return integrationEventEnvelopeSchema.parse({
      id: row.id,
      type: row.type,
      workspaceId: row.workspaceId,
      aggregateId: row.aggregateId,
      occurredAt: new Date(row.occurredAt).toISOString(),
      version: 1,
      data: row.data,
    });
  }
}
