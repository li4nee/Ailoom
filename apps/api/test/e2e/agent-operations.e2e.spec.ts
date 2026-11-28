// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_OPERATIONS_POLICY, type AgentOperationsPolicyUpdate } from '@app/shared';

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
let otherOwner: AuthedClient;
let workspaceId: string;
let ownerId: string;
let agentId: string;
let emailSequence = 0;

beforeAll(async () => {
  t = await createTestApp();
  await t.app.listen(0);
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await resetDatabase(t.ds);
  emailSequence += 1;
  const ownerAccount = await createUser(
    { ds: t.ds },
    { email: `operations-owner-${String(emailSequence)}@example.com` },
  );
  const workspace = await createWorkspace(t, ownerAccount.user, 'Agent operations');
  workspaceId = workspace.id;
  ownerId = ownerAccount.user.id;
  owner = authed(t, await loginAs(t, ownerAccount.user, ownerAccount.password));

  const agentAccount = await createUser(
    { ds: t.ds },
    { email: `operations-agent-${String(emailSequence)}@example.com` },
  );
  agentId = agentAccount.user.id;
  await addMember(t, workspace, agentAccount.user, 'agent');
  agent = authed(t, await loginAs(t, agentAccount.user, agentAccount.password));

  const otherAccount = await createUser(
    { ds: t.ds },
    { email: `operations-other-${String(emailSequence)}@example.com` },
  );
  await createWorkspace(t, otherAccount.user, 'Other workspace');
  otherOwner = authed(t, await loginAs(t, otherAccount.user, otherAccount.password));
});

describe('agent operations endpoints', () => {
  it('keeps routing disabled by default and restricts policy changes to admins', async () => {
    const path = `/api/v1/workspaces/${workspaceId}/agent-operations`;
    const initial = await owner.get(path).expect(200);
    expect(initial.body).toMatchObject({ routing: { enabled: false } });

    const update: AgentOperationsPolicyUpdate = {
      routing: {
        enabled: true,
        strategy: 'round_robin',
        maxOpenConversationsPerAgent: 5,
        eligibleRoles: ['agent', 'admin', 'owner'],
      },
      sla: DEFAULT_AGENT_OPERATIONS_POLICY.sla,
    };
    await owner.put(path).send(update).expect(200);
    await agent.put(path).send(update).expect(403);

    const forbiddenWorkspace = await otherOwner.get(path);
    expect([403, 404]).toContain(forbiddenWorkspace.status);
  });

  it('lets members update only their own presence and keeps it workspace scoped', async () => {
    const path = `/api/v1/workspaces/${workspaceId}/agent-operations/presence`;
    await owner.put(path).send({ state: 'online' }).expect(200);
    await agent.put(path).send({ state: 'online' }).expect(200);

    const roster = await owner.get(path).expect(200);
    expect(roster.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: agentId, state: 'online' }),
        expect.objectContaining({ userId: ownerId, state: 'online' }),
      ]),
    );
    await agent.put(path).send({ state: 'offline', userId: ownerId }).expect(200);
    const updatedRoster = await owner.get(path).expect(200);
    expect(updatedRoster.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: agentId, state: 'offline' }),
        expect.objectContaining({ userId: ownerId, state: 'online' }),
      ]),
    );

    const forbiddenWorkspace = await otherOwner.get(path);
    expect([403, 404]).toContain(forbiddenWorkspace.status);
  });
});
