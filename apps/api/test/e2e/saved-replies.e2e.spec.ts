// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import {
  addMember,
  authed,
  type AuthedClient,
  createUser,
  createWorkspace,
  loginAs,
} from '../helpers/factories';

let t: TestApp;
let owner: AuthedClient;
let agent: AuthedClient;
let workspaceId: string;

function path(query = ''): string {
  return `/api/v1/workspaces/${workspaceId}/saved-replies${query}`;
}

describe('saved replies', () => {
  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    const ownerAccount = await createUser(
      { ds: t.ds },
      { email: `saved-owner-${crypto.randomUUID()}@example.com`, name: 'Reply Owner' },
    );
    const workspace = await createWorkspace(t, ownerAccount.user, 'Replies');
    workspaceId = workspace.id;
    owner = authed(t, await loginAs(t, ownerAccount.user, ownerAccount.password));
    const agentAccount = await createUser(
      { ds: t.ds },
      { email: `saved-agent-${crypto.randomUUID()}@example.com`, name: 'Reply Agent' },
    );
    await addMember(t, workspace, agentAccount.user, 'agent');
    agent = authed(t, await loginAs(t, agentAccount.user, agentAccount.password));
  });

  it('limits management to admins while agents can search and read active replies', async () => {
    const created = await owner.post(path()).send({ title: 'Greeting', body: 'Hello there.' });
    expect(created.status).toBe(201);
    const createdBody = created.body as { id: string };
    const id = createdBody.id;

    expect((await agent.get(path('?q=hello'))).body).toMatchObject([
      { id, title: 'Greeting', body: 'Hello there.' },
    ]);
    expect((await agent.post(path()).send({ title: 'Blocked', body: 'No.' })).status).toBe(403);

    const updated = await owner
      .patch(`${path()}/${id}`)
      .send({ title: 'Welcome', body: 'Welcome!' });
    expect(updated.status).toBe(200);
    const updatedBody = updated.body as { title: string; body: string };
    expect(updatedBody).toMatchObject({ title: 'Welcome', body: 'Welcome!' });
    expect((await owner.delete(`${path()}/${id}`)).status).toBe(204);
    expect((await agent.get(path())).body).toEqual([]);
    const archived = (await owner.get(path('?includeArchived=true'))).body as {
      id: string;
      archivedAt: string | null;
    }[];
    expect(archived).toHaveLength(1);
    expect(archived[0]?.id).toBe(id);
    expect(typeof archived[0]?.archivedAt).toBe('string');
  });

  it('enforces case-insensitive active-title uniqueness and releases titles on archive', async () => {
    const first = await owner.post(path()).send({ title: 'Returns', body: 'First.' });
    expect(first.status).toBe(201);
    const firstBody = first.body as { id: string };
    expect((await owner.post(path()).send({ title: ' returns ', body: 'Duplicate.' })).status).toBe(
      409,
    );
    expect((await owner.delete(`${path()}/${firstBody.id}`)).status).toBe(204);
    expect((await owner.post(path()).send({ title: 'returns', body: 'Second.' })).status).toBe(201);
  });
});
