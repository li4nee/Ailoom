// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../../common/clock';
import { SecretBox } from '../../../common/crypto';
import { WebhooksService } from './webhooks.service';

const WORKSPACE_ID = '0190b000-0000-7000-8000-000000000043' as never;
const WEBHOOK_ID = '0190b000-0000-7000-8000-000000000044';
const DELIVERY_ID = '0190b000-0000-7000-8000-000000000045';
const NOW = new Date('2026-01-01T00:00:00Z');

function webhook(status: 'active' | 'paused' = 'active') {
  const secrets = new SecretBox([{ version: 1, key: randomBytes(32) }]);
  const sealed = secrets.seal('whsec_original');
  return {
    id: WEBHOOK_ID,
    workspaceId: WORKSPACE_ID,
    url: 'https://hooks.example.test/ailoom',
    events: ['message.created'],
    status,
    ...{
      secretCiphertext: sealed.ciphertext,
      secretIv: sealed.iv,
      secretTag: sealed.tag,
      keyVersion: sealed.keyVersion,
    },
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeService(row = webhook()) {
  const webhooks = {
    listForWorkspace: vi.fn().mockResolvedValue([row]),
    insertWebhook: vi.fn().mockResolvedValue(row),
    getById: vi.fn().mockResolvedValue(row),
    updateById: vi
      .fn()
      .mockImplementation((_ws: unknown, _id: string, patch: object) =>
        Promise.resolve({ ...row, ...patch, updatedAt: NOW }),
      ),
    deleteById: vi.fn().mockResolvedValue(undefined),
  };
  const deliveries = {
    getById: vi.fn().mockResolvedValue({
      id: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      webhookId: WEBHOOK_ID,
      eventId: '0190b000-0000-7000-8000-000000000046',
      eventType: 'message.created',
      status: 'pending',
      attemptCount: 0,
      statusCode: null,
      durationMs: null,
      lastError: null,
      nextAttemptAt: null,
      deliveredAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    }),
    updateById: vi.fn().mockResolvedValue(undefined),
    listForWebhook: vi.fn().mockResolvedValue([]),
  };
  const dataSource = {
    transaction: vi.fn(async (callback: (manager: unknown) => Promise<unknown>) => callback({})),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const jobs = { enqueue: vi.fn().mockResolvedValue('job') };
  const outbox = { getById: vi.fn() };
  const secrets = new SecretBox([{ version: 1, key: randomBytes(32) }]);
  // Re-seal the fixture with this service's key ring so the paused path remains independent of it.
  const service = new WebhooksService(
    dataSource as never,
    webhooks as never,
    deliveries as never,
    outbox as never,
    jobs as never,
    secrets,
    new FixedClock(NOW),
    audit,
    { crawl: { userAgent: 'test' } } as never,
  );
  return { service, webhooks, deliveries, audit, secrets };
}

describe('WebhooksService', () => {
  it('returns a secret only when creating the webhook and stores encrypted material', async () => {
    const { service, webhooks, audit } = makeService();
    const created = await service.create(WORKSPACE_ID, '0190b000-0000-7000-8000-000000000047', {
      url: 'https://hooks.example.test/ailoom',
      events: ['message.created'],
    });

    expect(created.secret).toMatch(/^whsec_/);
    expect(created.webhook).not.toHaveProperty('secretCiphertext');
    expect(webhooks.insertWebhook).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook.created' }),
      expect.anything(),
    );
  });

  it('marks deliveries skipped while a webhook is paused', async () => {
    const row = webhook('paused');
    const { service, deliveries } = makeService(row);

    await service.deliver(WORKSPACE_ID, WEBHOOK_ID, DELIVERY_ID);

    expect(deliveries.updateById).toHaveBeenCalledWith(
      WORKSPACE_ID,
      DELIVERY_ID,
      expect.objectContaining({ status: 'skipped', lastError: 'webhook_paused' }),
    );
  });
});
