// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

interface CreatedKeyBody {
  token: string;
  key: { id: string };
}

interface ApiKeyListItem {
  id: string;
  prefix: string;
}

import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import {
  authed,
  type AuthedClient,
  createUser,
  createWorkspace,
  loginAs,
} from '../helpers/factories';

describe('workspace API keys', () => {
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
    const { user, password } = await createUser({ ds: t.ds }, { email: 'api-keys@example.com' });
    workspaceId = (await createWorkspace(t, user, 'API Keys')).id;
    owner = authed(t, await loginAs(t, user, password));
  });

  it('creates a key, authenticates conversation reads, and never returns the key again', async () => {
    const created = await owner.post(`/api/v1/workspaces/${workspaceId}/api-keys`).send({
      name: 'Integration test',
      scopes: ['conversations:read'],
    });
    const createdBody = created.body as CreatedKeyBody;

    expect(created.status).toBe(201);
    expect(createdBody.token).toMatch(/^ak_live_/);
    expect(createdBody.key).not.toHaveProperty('keyHash');

    const listed = await owner.get(`/api/v1/workspaces/${workspaceId}/api-keys`);
    const listedBody = listed.body as ApiKeyListItem[];
    expect(listed.status).toBe(200);
    expect(listedBody).toHaveLength(1);
    expect(listedBody[0]).not.toHaveProperty('token');

    const machine = await t.http
      .get(`/api/v1/workspaces/${workspaceId}/conversations`)
      .set('Authorization', `Bearer ${createdBody.token}`);
    expect(machine.status).toBe(200);
  });

  it('enforces scopes and revocation immediately', async () => {
    const created = await owner.post(`/api/v1/workspaces/${workspaceId}/api-keys`).send({
      name: 'Read only',
      scopes: ['conversations:read'],
    });
    const createdBody = created.body as CreatedKeyBody;

    const denied = await t.http
      .post(`/api/v1/workspaces/${workspaceId}/conversations/not-a-conversation/messages`)
      .set('Authorization', `Bearer ${createdBody.token}`)
      .send({ content: 'not allowed' });
    expect(denied.status).toBe(403);

    const revoked = await owner.delete(
      `/api/v1/workspaces/${workspaceId}/api-keys/${createdBody.key.id}`,
    );
    expect(revoked.status).toBe(200);

    const unauthorized = await t.http
      .get(`/api/v1/workspaces/${workspaceId}/conversations`)
      .set('Authorization', `Bearer ${createdBody.token}`);
    expect(unauthorized.status).toBe(401);
  });
});
