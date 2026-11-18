// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { IntegrationEventType } from '@app/shared';

import type { WorkspaceId } from '../../../db/ids';
import { TenantRepository } from '../../../db/tenant.repository';
import { WebhookDeliveryEntity } from './webhook-delivery.entity';
import { WebhookEntity } from './webhook.entity';

@Injectable()
export class WebhooksRepository extends TenantRepository<WebhookEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(WebhookEntity));
  }

  listForWorkspace(workspaceId: WorkspaceId, manager?: EntityManager): Promise<WebhookEntity[]> {
    return (manager ?? this.ds).getRepository(WebhookEntity).find({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
    });
  }

  insertWebhook(
    workspaceId: WorkspaceId,
    data: Partial<WebhookEntity>,
    manager?: EntityManager,
  ): Promise<WebhookEntity> {
    return this.insert(workspaceId, data, manager);
  }
}

@Injectable()
export class WebhookDeliveriesRepository extends TenantRepository<WebhookDeliveryEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(WebhookDeliveryEntity));
  }

  findForEvent(
    workspaceId: WorkspaceId,
    webhookId: string,
    eventId: string,
    manager?: EntityManager,
  ): Promise<WebhookDeliveryEntity | null> {
    return (manager ?? this.ds).getRepository(WebhookDeliveryEntity).findOne({
      where: { workspaceId, webhookId, eventId },
    });
  }

  insertDelivery(
    workspaceId: WorkspaceId,
    data: {
      webhookId: string;
      eventId: string;
      eventType: IntegrationEventType;
    },
    manager?: EntityManager,
  ): Promise<WebhookDeliveryEntity> {
    return this.insert(
      workspaceId,
      {
        ...data,
        status: 'pending',
        attemptCount: 0,
        statusCode: null,
        durationMs: null,
        lastError: null,
        nextAttemptAt: null,
        deliveredAt: null,
      },
      manager,
    );
  }

  listForWebhook(workspaceId: WorkspaceId, webhookId: string): Promise<WebhookDeliveryEntity[]> {
    return this.ds.getRepository(WebhookDeliveryEntity).find({
      where: { workspaceId, webhookId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }
}
