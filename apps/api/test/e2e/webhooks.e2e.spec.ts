// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '../../src/common/ids';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import {
  authed,
  type AuthedClient,
  createUser,
  createWorkspace,
  loginAs,
} from '../helpers/factories';

interface CreatedWebhookBody {
  secret: string;
  webhook: { id: string };
}

interface WebhookListItem {
  id: string;
  status: string;
}

describe('workspace webhooks', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let workspaceId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    const { user, password } = await createUser({ ds: t.ds }, { email: 'webhooks@example.com' });
    workspaceId = (await createWorkspace(t, user, 'Webhooks')).id;
    owner = authed(t, await loginAs(t, user, password));
  });

  it('creates, rotates, pauses, resumes, and never lists the signing secret', async () => {
    const created = await owner.post(`/api/v1/workspaces/${workspaceId}/webhooks`).send({
      url: 'https://hooks.example.test/ailoom',
      events: ['message.created', 'handoff.requested'],
    });
    const createdBody = created.body as CreatedWebhookBody;

    expect(created.status).toBe(201);
    expect(createdBody.secret).toMatch(/^whsec_/);

    const listed = await owner.get(`/api/v1/workspaces/${workspaceId}/webhooks`);
    const listedBody = listed.body as WebhookListItem[];
    expect(listed.status).toBe(200);
    expect(listedBody).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(createdBody.secret);

    const rotated = await owner.post(
      `/api/v1/workspaces/${workspaceId}/webhooks/${createdBody.webhook.id}/rotate`,
    );
    expect(rotated.status).toBe(201);
    expect((rotated.body as CreatedWebhookBody).secret).not.toBe(createdBody.secret);

    const paused = await owner.post(
      `/api/v1/workspaces/${workspaceId}/webhooks/${createdBody.webhook.id}/pause`,
    );
    expect((paused.body as WebhookListItem).status).toBe('paused');

    const resumed = await owner.post(
      `/api/v1/workspaces/${workspaceId}/webhooks/${createdBody.webhook.id}/resume`,
    );
    expect((resumed.body as WebhookListItem).status).toBe('active');
  });

  it('lists failed deliveries and replays one without changing its workspace', async () => {
    const created = await owner.post(`/api/v1/workspaces/${workspaceId}/webhooks`).send({
      url: 'https://hooks.example.test/replay',
      events: ['message.created'],
    });
    const webhookId = (created.body as CreatedWebhookBody).webhook.id;
    const eventId = newId();
    const aggregateId = newId();
    const deliveryId = newId();

    await t.ds.query(
      `INSERT INTO integration_events
         (id, workspace_id, type, aggregate_id, idempotency_key, data, occurred_at)
       VALUES ($1, $2, 'message.created', $3, $4, $5::jsonb, now())`,
      [eventId, workspaceId, aggregateId, `webhook-replay-${eventId}`, JSON.stringify({})],
    );
    await t.ds.query(
      `INSERT INTO webhook_deliveries
         (id, workspace_id, webhook_id, event_id, event_type, status, attempt_count, last_error)
       VALUES ($1, $2, $3, $4, 'message.created', 'failed', 6, 'http_500')`,
      [deliveryId, workspaceId, webhookId, eventId],
    );

    const listed = await owner.get(
      `/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}/deliveries`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({
        id: deliveryId,
        webhookId,
        status: 'failed',
        attemptCount: 6,
        lastError: 'http_500',
      }),
    ]);

    const replayed = await owner.post(
      `/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}/deliveries/${deliveryId}/replay`,
    );
    expect(replayed.status).toBe(204);
    const reset = await t.ds.query<
      { status: string; attempt_count: number; last_error: string | null }[]
    >(
      `SELECT status, attempt_count, last_error
         FROM webhook_deliveries
        WHERE id = $1 AND workspace_id = $2`,
      [deliveryId, workspaceId],
    );
    expect(reset).toEqual([{ status: 'pending', attempt_count: 0, last_error: null }]);

    const jobs = await t.ds.query<{ data: { webhookId: string; deliveryId: string } }[]>(
      `SELECT data
         FROM pgboss.job
        WHERE name = 'integrations.webhook-delivery'
          AND data->>'deliveryId' = $1`,
      [deliveryId],
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toMatchObject({ workspaceId, webhookId, deliveryId });
  });
});
