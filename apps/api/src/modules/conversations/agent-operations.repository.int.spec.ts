// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_OPERATIONS_POLICY } from '@app/shared';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { addMember, createUser, createWorkspace } from '../../../test/helpers/factories';
import { asWorkspaceId } from '../../db/ids';
import { AgentOperationsRepository } from './agent-operations.repository';

let ds: DataSource;
let repository: AgentOperationsRepository;

beforeAll(async () => {
  ds = await getTestDataSource();
  repository = new AgentOperationsRepository(ds);
});

beforeEach(async () => {
  await resetDatabase(ds);
});

async function seedHandoffs() {
  const owner = await createUser({ ds }, { email: 'ops-owner@example.com' });
  const workspace = await createWorkspace({ ds }, owner.user, 'Agent operations');
  const agents = await Promise.all([
    createUser({ ds }, { email: 'amy-agent@example.com' }),
    createUser({ ds }, { email: 'ben-agent@example.com' }),
  ]);
  await Promise.all(agents.map(({ user }) => addMember({ ds }, workspace, user, 'agent')));
  await ds.query(
    `UPDATE memberships
        SET presence_state = 'online', presence_expires_at = now() + interval '5 minutes'
      WHERE workspace_id = $1 AND role = 'agent'`,
    [workspace.id],
  );
  const credential = await ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', 'Agent operations') RETURNING id`,
    [workspace.id],
  );
  const bot = await ds.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim)
     VALUES ($1, 'Support', 'pk_live_agent_operations', $2, 'mock-chat', $2,
             'mock-embed', 384) RETURNING id`,
    [workspace.id, credential[0]?.id],
  );
  const contact = await ds.query<{ id: string }[]>(
    `INSERT INTO contacts (workspace_id) VALUES ($1) RETURNING id`,
    [workspace.id],
  );
  const conversations = await ds.query<{ id: string }[]>(
    `INSERT INTO conversations (workspace_id, bot_id, contact_id, status, handoff_requested_at)
     SELECT $1, $2, $3, 'needs_human', now()
       FROM generate_series(1, 2)
     RETURNING id`,
    [workspace.id, bot[0]?.id, contact[0]?.id],
  );
  const policy = {
    ...DEFAULT_AGENT_OPERATIONS_POLICY,
    routing: {
      ...DEFAULT_AGENT_OPERATIONS_POLICY.routing,
      enabled: true,
      maxOpenConversationsPerAgent: 1,
    },
  };
  await ds.query('UPDATE workspaces SET agent_operations = $2 WHERE id = $1', [
    workspace.id,
    JSON.stringify(policy),
  ]);
  return {
    workspaceId: asWorkspaceId(workspace.id),
    agentIds: agents.map(({ user }) => user.id),
    conversationIds: conversations.map(({ id }) => id),
  };
}

describe('AgentOperationsRepository', () => {
  it('serializes concurrent handoffs so round-robin routing respects each capacity', async () => {
    const { workspaceId, agentIds, conversationIds } = await seedHandoffs();
    const now = new Date();
    const assigned = await Promise.all(
      conversationIds.map((id) => repository.autoAssign(workspaceId, id, now)),
    );

    expect(assigned.every((result) => result !== null)).toBe(true);
    expect(new Set(assigned.map((result) => result?.assignedUserId)).size).toBe(2);
    expect(assigned.every((result) => agentIds.includes(result?.assignedUserId ?? ''))).toBe(true);
  });

  it('does not route to an online member whose presence lease has expired', async () => {
    const { workspaceId, conversationIds } = await seedHandoffs();
    await ds.query(
      `UPDATE memberships SET presence_expires_at = now() - interval '1 second'
        WHERE workspace_id = $1 AND role = 'agent'`,
      [workspaceId],
    );

    expect(
      await repository.autoAssign(workspaceId, conversationIds[0] ?? '', new Date()),
    ).toBeNull();
  });

  it('marks each due SLA breach once, including both targets on one conversation', async () => {
    const { workspaceId, conversationIds } = await seedHandoffs();
    const conversationId = conversationIds[0] ?? '';
    const dueAt = new Date(Date.now() - 60_000);
    await ds.query(
      `UPDATE conversations
          SET first_response_due_at = $3, resolution_due_at = $3
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, conversationId, dueAt],
    );

    const [firstScan, secondScan] = await ds.transaction(async (manager) => {
      const first = await repository.claimSlaBreaches(new Date(), manager, 100);
      const second = await repository.claimSlaBreaches(new Date(), manager, 100);
      return [first, second];
    });

    expect(firstScan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conversationId, breach: 'first_response' }),
        expect.objectContaining({ conversationId, breach: 'resolution' }),
      ]),
    );
    expect(firstScan).toHaveLength(2);
    expect(secondScan).toHaveLength(0);
  });
});
