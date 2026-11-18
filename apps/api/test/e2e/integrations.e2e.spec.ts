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

interface IntegrationBody {
  id: string;
  status: string;
  transcriptSharing: boolean;
}

describe('workspace integrations', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    const { user, password } = await createUser(
      { ds: t.ds },
      { email: 'integrations@example.com' },
    );
    const { user: otherUser } = await createUser(
      { ds: t.ds },
      { email: 'other-integrations@example.com' },
    );
    workspaceId = (await createWorkspace(t, user, 'Integrations')).id;
    otherWorkspaceId = (await createWorkspace(t, otherUser, 'Other Integrations')).id;
    owner = authed(t, await loginAs(t, user, password));
  });

  it('connects, pauses, resumes, and disconnects without exposing credentials', async () => {
    const connected = await owner.post(`/api/v1/workspaces/${workspaceId}/integrations`).send({
      provider: 'hubspot',
      name: 'Support CRM',
      scopes: ['contacts.read'],
      accessToken: 'oauth-secret-e2e',
      refreshToken: 'refresh-secret-e2e',
      externalAccountId: 'portal-123',
    });
    const connectedBody = connected.body as IntegrationBody;

    expect(connected.status).toBe(201);
    expect(connectedBody.status).toBe('active');
    expect(connectedBody.transcriptSharing).toBe(false);
    expect(JSON.stringify(connected.body)).not.toContain('oauth-secret-e2e');

    const paused = await owner.post(
      `/api/v1/workspaces/${workspaceId}/integrations/${connectedBody.id}/pause`,
    );
    expect(paused.status).toBe(201);
    expect((paused.body as IntegrationBody).status).toBe('paused');

    const resumed = await owner.post(
      `/api/v1/workspaces/${workspaceId}/integrations/${connectedBody.id}/resume`,
    );
    expect(resumed.status).toBe(201);
    expect((resumed.body as IntegrationBody).status).toBe('active');

    const disconnected = await owner.delete(
      `/api/v1/workspaces/${workspaceId}/integrations/${connectedBody.id}`,
    );
    expect(disconnected.status).toBe(204);

    const listed = await owner.get(`/api/v1/workspaces/${workspaceId}/integrations`);
    expect(listed.status).toBe(200);
    expect((listed.body as IntegrationBody[])[0]?.status).toBe('disconnected');
  });

  it('does not allow an integration id to cross workspace boundaries', async () => {
    const connected = await owner.post(`/api/v1/workspaces/${workspaceId}/integrations`).send({
      provider: 'zendesk',
      name: 'Support',
      scopes: [],
      accessToken: 'secret',
    });
    const id = (connected.body as IntegrationBody).id;

    const crossTenant = await owner.post(
      `/api/v1/workspaces/${otherWorkspaceId}/integrations/${id}/pause`,
    );
    expect(crossTenant.status).toBe(404);
  });
});
