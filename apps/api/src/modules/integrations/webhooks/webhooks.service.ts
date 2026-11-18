// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type {
  CreateWebhookRequest,
  CreatedWebhook,
  IntegrationEventType,
  WebhookDeliveryDto,
  WebhookDto,
} from '@app/shared';
import { createWebhookRequestSchema } from '@app/shared';

import { Clock } from '../../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../../common/config';
import { SecretBox, randomToken } from '../../../common/crypto';
import { AppError } from '../../../common/errors';
import { newId } from '../../../common/ids';
import { AUDIT_LOG, type AuditWriter } from '../../../common/ports/audit';
import { safeFetch, SafeFetchError, webhookPolicy } from '../../../common/safe-fetch';
import { asWorkspaceId, type WorkspaceId } from '../../../db/ids';
import { JobsService } from '../../../jobs';
import { integrationEventEnvelopeSchema } from '../integration-events';
import { OutboxRepository } from '../outbox.repository';
import type { WebhookDeliveryEntity } from './webhook-delivery.entity';
import { WEBHOOK_DELIVERY_JOB } from './webhook-delivery.job';
import { signWebhook } from './webhook-signature';
import { toWebhookDeliveryDto, toWebhookDto } from './webhooks.mapper';
import { WebhookDeliveriesRepository, WebhooksRepository } from './webhooks.repository';

const MAX_ATTEMPTS = 6;

class RetryableWebhookError extends Error {}

function safeError(error: unknown): string {
  if (error instanceof SafeFetchError) return error.code;
  if (error instanceof RetryableWebhookError) return 'delivery_retryable';
  return 'delivery_failed';
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly ds: DataSource,
    private readonly webhooks: WebhooksRepository,
    private readonly deliveries: WebhookDeliveriesRepository,
    private readonly outbox: OutboxRepository,
    private readonly jobs: JobsService,
    private readonly secrets: SecretBox,
    private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(workspaceId: WorkspaceId): Promise<WebhookDto[]> {
    return (await this.webhooks.listForWorkspace(workspaceId)).map(toWebhookDto);
  }

  async create(
    workspaceId: WorkspaceId,
    actorUserId: string,
    input: CreateWebhookRequest,
  ): Promise<CreatedWebhook> {
    const parsed = createWebhookRequestSchema.safeParse(input);
    if (!parsed.success) throw new AppError('validation_failed', { cause: parsed.error });
    const secret = `whsec_${randomToken(32)}`;
    const sealed = this.secrets.seal(secret);
    const webhook = await this.ds.transaction(async (manager) => {
      const created = await this.webhooks.insertWebhook(
        workspaceId,
        {
          url: parsed.data.url,
          events: [...new Set(parsed.data.events)],
          status: 'active',
          ...this.secretColumns(sealed),
          lastError: null,
        },
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'webhook.created',
          targetType: 'webhook',
          targetId: created.id,
          metadata: { url: created.url, events: created.events },
        },
        manager,
      );
      return created;
    });
    return { webhook: toWebhookDto(webhook), secret };
  }

  async rotate(workspaceId: WorkspaceId, actorUserId: string, id: string): Promise<CreatedWebhook> {
    const secret = `whsec_${randomToken(32)}`;
    const webhook = await this.ds.transaction(async (manager) => {
      const existing = await this.webhooks.getById(workspaceId, id, 'not_found', manager);
      const updated = await this.webhooks.updateById(
        workspaceId,
        id,
        this.secretColumns(this.secrets.seal(secret)),
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'webhook.rotated',
          targetType: 'webhook',
          targetId: id,
          metadata: { url: existing.url },
        },
        manager,
      );
      return updated;
    });
    return { webhook: toWebhookDto(webhook), secret };
  }

  async setStatus(
    workspaceId: WorkspaceId,
    actorUserId: string,
    id: string,
    status: 'active' | 'paused',
  ): Promise<WebhookDto> {
    const updated = await this.webhooks.updateById(workspaceId, id, { status });
    await this.audit.record({
      workspaceId,
      actorUserId,
      action: status === 'active' ? 'webhook.resumed' : 'webhook.paused',
      targetType: 'webhook',
      targetId: id,
      metadata: {},
    });
    return toWebhookDto(updated);
  }

  async remove(workspaceId: WorkspaceId, actorUserId: string, id: string): Promise<void> {
    await this.webhooks.getById(workspaceId, id);
    await this.webhooks.deleteById(workspaceId, id);
    await this.audit.record({
      workspaceId,
      actorUserId,
      action: 'webhook.deleted',
      targetType: 'webhook',
      targetId: id,
      metadata: {},
    });
  }

  async listDeliveries(workspaceId: WorkspaceId, webhookId: string): Promise<WebhookDeliveryDto[]> {
    await this.webhooks.getById(workspaceId, webhookId);
    return (await this.deliveries.listForWebhook(workspaceId, webhookId)).map(toWebhookDeliveryDto);
  }

  async replay(
    workspaceId: WorkspaceId,
    actorUserId: string,
    webhookId: string,
    deliveryId: string,
  ): Promise<void> {
    const delivery = await this.deliveries.getById(workspaceId, deliveryId);
    if (delivery.webhookId !== webhookId) throw new AppError('not_found');
    const reset = await this.deliveries.updateById(workspaceId, deliveryId, {
      status: 'pending',
      attemptCount: 0,
      statusCode: null,
      durationMs: null,
      lastError: null,
      nextAttemptAt: null,
      deliveredAt: null,
    });
    await this.jobs.enqueue(
      WEBHOOK_DELIVERY_JOB,
      { workspaceId, webhookId, deliveryId: reset.id },
      { singletonKey: `webhook:${webhookId}:delivery:${deliveryId}:replay` },
    );
    await this.audit.record({
      workspaceId,
      actorUserId,
      action: 'webhook.replayed',
      targetType: 'webhook_delivery',
      targetId: deliveryId,
      metadata: { webhookId },
    });
  }

  /** Creates one delivery per active matching webhook in the same transaction as its job row. */
  async enqueueEvent(event: {
    id: string;
    workspaceId: string;
    type: IntegrationEventType;
  }): Promise<void> {
    const workspaceId = asWorkspaceId(event.workspaceId);
    await this.ds.transaction(async (manager) => {
      const targets = (await this.webhooks.listForWorkspace(workspaceId, manager)).filter(
        (webhook) => webhook.status === 'active' && webhook.events.includes(event.type),
      );
      for (const webhook of targets) {
        const existing = await this.deliveries.findForEvent(
          workspaceId,
          webhook.id,
          event.id,
          manager,
        );
        if (existing !== null) continue;
        const delivery = await this.deliveries.insertDelivery(
          workspaceId,
          { webhookId: webhook.id, eventId: event.id, eventType: event.type },
          manager,
        );
        await this.jobs.enqueue(
          WEBHOOK_DELIVERY_JOB,
          { workspaceId, webhookId: webhook.id, deliveryId: delivery.id },
          { manager, singletonKey: `webhook:${webhook.id}:event:${event.id}` },
        );
      }
    });
  }

  async deliver(workspaceId: WorkspaceId, webhookId: string, deliveryId: string): Promise<void> {
    const webhook = await this.webhooks.getById(workspaceId, webhookId);
    const delivery = await this.deliveries.getById(workspaceId, deliveryId);
    if (delivery.webhookId !== webhook.id) throw new AppError('not_found');
    if (webhook.status !== 'active') {
      await this.deliveries.updateById(workspaceId, delivery.id, {
        status: 'skipped',
        lastError: 'webhook_paused',
      });
      return;
    }
    const event = await this.outbox.getById(workspaceId, delivery.eventId);
    const envelope = integrationEventEnvelopeSchema.parse({
      id: event.id,
      type: event.type,
      workspaceId: event.workspaceId,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt.toISOString(),
      version: 1,
      data: event.data,
    });
    const body = JSON.stringify(envelope);
    const timestamp = String(Math.floor(this.clock.now().getTime() / 1000));
    const secret = this.secrets.open({
      ciphertext: webhook.secretCiphertext,
      iv: webhook.secretIv,
      tag: webhook.secretTag,
      keyVersion: webhook.keyVersion,
    });
    const attempt = delivery.attemptCount + 1;
    const started = this.clock.now();
    await this.deliveries.updateById(workspaceId, delivery.id, {
      status: 'retrying',
      attemptCount: attempt,
      lastError: null,
    });
    delivery.attemptCount = attempt;
    try {
      const response = await safeFetch(
        webhook.url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ailoom-event-id': event.id,
            'x-ailoom-event-type': event.type,
            'x-ailoom-timestamp': timestamp,
            'x-ailoom-signature': signWebhook(timestamp, body, secret),
          },
          body,
        },
        webhookPolicy(this.config),
      );
      await response.arrayBuffer();
      const durationMs = this.clock.now().getTime() - started.getTime();
      if (response.status >= 200 && response.status < 300) {
        await this.deliveries.updateById(workspaceId, delivery.id, {
          status: 'delivered',
          statusCode: response.status,
          durationMs,
          lastError: null,
          nextAttemptAt: null,
          deliveredAt: this.clock.now(),
        });
        return;
      }
      await this.recordFailure(
        workspaceId,
        delivery,
        response.status,
        durationMs,
        retryableStatus(response.status),
        `http_${String(response.status)}`,
      );
    } catch (error) {
      if (error instanceof RetryableWebhookError) throw error;
      const durationMs = this.clock.now().getTime() - started.getTime();
      const retryable =
        error instanceof SafeFetchError &&
        ['timeout', 'connection_failed', 'dns_failed'].includes(error.code);
      await this.recordFailure(
        workspaceId,
        delivery,
        null,
        durationMs,
        retryable,
        safeError(error),
      );
    }
  }

  async test(
    workspaceId: WorkspaceId,
    webhookId: string,
  ): Promise<{ ok: boolean; statusCode: number }> {
    const webhook = await this.webhooks.getById(workspaceId, webhookId);
    const secret = this.secrets.open({
      ciphertext: webhook.secretCiphertext,
      iv: webhook.secretIv,
      tag: webhook.secretTag,
      keyVersion: webhook.keyVersion,
    });
    const body = JSON.stringify({
      type: 'webhook.test',
      id: newId(),
      sentAt: this.clock.now().toISOString(),
    });
    const timestamp = String(Math.floor(this.clock.now().getTime() / 1000));
    const response = await safeFetch(
      webhook.url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ailoom-event-id': 'test',
          'x-ailoom-event-type': 'webhook.test',
          'x-ailoom-timestamp': timestamp,
          'x-ailoom-signature': signWebhook(timestamp, body, secret),
        },
        body,
      },
      webhookPolicy(this.config),
    );
    await response.arrayBuffer();
    return { ok: response.status >= 200 && response.status < 300, statusCode: response.status };
  }

  private async recordFailure(
    workspaceId: WorkspaceId,
    delivery: WebhookDeliveryEntity,
    statusCode: number | null,
    durationMs: number,
    retryable: boolean,
    errorCode: string,
  ): Promise<void> {
    const terminal = !retryable || delivery.attemptCount >= MAX_ATTEMPTS;
    const nextAttemptAt = terminal
      ? null
      : new Date(this.clock.now().getTime() + Math.min(60_000, 5_000 * 2 ** delivery.attemptCount));
    await this.deliveries.updateById(workspaceId, delivery.id, {
      status: terminal ? 'failed' : 'retrying',
      statusCode,
      durationMs,
      lastError: errorCode.slice(0, 200),
      nextAttemptAt,
    });
    if (!terminal) throw new RetryableWebhookError(errorCode);
  }

  private secretColumns(sealed: ReturnType<SecretBox['seal']>) {
    return {
      secretCiphertext: sealed.ciphertext,
      secretIv: sealed.iv,
      secretTag: sealed.tag,
      keyVersion: sealed.keyVersion,
    };
  }
}
