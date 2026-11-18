// SPDX-License-Identifier: AGPL-3.0-only
import type { WebhookDeliveryDto, WebhookDto } from '@app/shared';

import type { WebhookDeliveryEntity } from './webhook-delivery.entity';
import type { WebhookEntity } from './webhook.entity';

export function toWebhookDto(row: WebhookEntity): WebhookDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    url: row.url,
    events: row.events,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastError: row.lastError,
  };
}

export function toWebhookDeliveryDto(row: WebhookDeliveryEntity): WebhookDeliveryDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    webhookId: row.webhookId,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
