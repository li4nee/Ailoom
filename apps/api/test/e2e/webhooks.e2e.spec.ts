// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
});
