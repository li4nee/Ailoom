// SPDX-License-Identifier: AGPL-3.0-only
import type { IntegrationDeliveryDto, IntegrationDto } from '@app/shared';

import type { IntegrationDeliveryEntity } from './integration-delivery.entity';
import type { IntegrationEntity } from './integration.entity';

export function toIntegrationDeliveryDto(row: IntegrationDeliveryEntity): IntegrationDeliveryDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    integrationId: row.integrationId,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attemptCount: row.attemptCount,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    lastError: row.lastError,
    externalObjectType: row.externalObjectType,
    externalObjectId: row.externalObjectId,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toIntegrationDto(row: IntegrationEntity): IntegrationDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider,
    name: row.name,
    status: row.status,
    scopes: row.scopes,
    externalAccountId: row.externalAccountId,
    transcriptSharing: row.transcriptSharing,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    disconnectedAt: row.disconnectedAt?.toISOString() ?? null,
  };
}
