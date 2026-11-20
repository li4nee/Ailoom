// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { IntegrationDeliveryStatus, IntegrationEventType } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { IntegrationDeliveryEntity } from './integration-delivery.entity';

export interface IntegrationDeliveryResult {
  status: Extract<IntegrationDeliveryStatus, 'delivered' | 'failed' | 'skipped' | 'retrying'>;
  statusCode?: number | null;
  durationMs?: number | null;
  lastError?: string | null;
  externalObjectType?: string | null;
  externalObjectId?: string | null;
}

@Injectable()
export class IntegrationDeliveriesRepository extends TenantRepository<IntegrationDeliveryEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(IntegrationDeliveryEntity));
  }

  async beginAttempt(
    workspaceId: WorkspaceId,
    integrationId: string,
    eventId: string,
    eventType: IntegrationEventType,
  ): Promise<boolean> {
    await this.ds.query(
      `INSERT INTO integration_deliveries
         (workspace_id, integration_id, event_id, event_type, status, attempt_count)
       VALUES ($1, $2, $3, $4, 'pending', 0)
       ON CONFLICT (integration_id, event_id) DO NOTHING`,
      [workspaceId, integrationId, eventId, eventType],
    );
    const [rows] = await this.ds.query<[{ id: string }[], number]>(
      `UPDATE integration_deliveries
          SET status = 'sending', attempt_count = attempt_count + 1,
              status_code = NULL, duration_ms = NULL, last_error = NULL,
              updated_at = now()
        WHERE workspace_id = $1 AND integration_id = $2 AND event_id = $3
          AND (status IN ('pending', 'retrying')
               OR (status = 'sending' AND updated_at < now() - interval '10 minutes'))
        RETURNING id`,
      [workspaceId, integrationId, eventId],
    );
    return rows.length > 0;
  }

  async finishAttempt(
    workspaceId: WorkspaceId,
    integrationId: string,
    eventId: string,
    result: IntegrationDeliveryResult,
  ): Promise<void> {
    await this.ds.query(
      `UPDATE integration_deliveries
          SET status = $4, status_code = $5, duration_ms = $6, last_error = $7,
              external_object_type = $8, external_object_id = $9,
              delivered_at = CASE WHEN $4 = 'delivered' THEN now() ELSE NULL END,
              updated_at = now()
        WHERE workspace_id = $1 AND integration_id = $2 AND event_id = $3`,
      [
        workspaceId,
        integrationId,
        eventId,
        result.status,
        result.statusCode ?? null,
        result.durationMs ?? null,
        result.lastError ?? null,
        result.externalObjectType ?? null,
        result.externalObjectId ?? null,
      ],
    );
  }

  async skip(
    workspaceId: WorkspaceId,
    integrationId: string,
    eventId: string,
    eventType: IntegrationEventType,
    reason: string,
  ): Promise<void> {
    await this.ds.query(
      `INSERT INTO integration_deliveries
         (workspace_id, integration_id, event_id, event_type, status, attempt_count, last_error)
       VALUES ($1, $2, $3, $4, 'skipped', 0, $5)
       ON CONFLICT (integration_id, event_id) DO UPDATE
         SET status = 'skipped', last_error = EXCLUDED.last_error, updated_at = now()
       WHERE integration_deliveries.status IN ('pending', 'sending', 'retrying')`,
      [workspaceId, integrationId, eventId, eventType, reason],
    );
  }

  listForIntegration(
    workspaceId: WorkspaceId,
    integrationId: string,
  ): Promise<IntegrationDeliveryEntity[]> {
    return this.ds.getRepository(IntegrationDeliveryEntity).find({
      where: { workspaceId, integrationId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }
}
