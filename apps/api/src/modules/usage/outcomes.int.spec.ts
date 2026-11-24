// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outcomesQuerySchema } from '@app/shared';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser, createWorkspace } from '../../../test/helpers/factories';
import { FixedClock } from '../../common/clock';
import { asWorkspaceId, type WorkspaceId } from '../../db/ids';
import { OutcomesRepository } from './outcomes.repository';
import { OutcomesService } from './outcomes.service';

const NOW = new Date('2026-11-20T12:00:00.000Z');

let ds: DataSource;
let service: OutcomesService;
let workspaceId: WorkspaceId;
let botId: string;
let otherWorkspaceId: WorkspaceId;
let otherBotId: string;

async function createBot(workspace: WorkspaceId, suffix: string): Promise<string> {
  const credentials = await ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', $2), ($1, 'mock', $3) RETURNING id`,
    [workspace, `Chat ${suffix}`, `Embed ${suffix}`],
  );
  const bot = await ds.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim)
     VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'mock-embed', 384) RETURNING id`,
    [
      workspace,
      `pk_outcome_${suffix}_${String(Date.now())}`,
      credentials[0]?.id,
      credentials[1]?.id,
    ],
  );
  return bot[0]?.id ?? '';
}

async function addConversation(input: {
  status: 'ai' | 'needs_human' | 'human' | 'closed';
  createdAt: string;
  handoffAt?: string;
  closedAt?: string;
  lastMessageAt?: string;
  ai?: { feedback?: number; content?: string };
  agentAt?: string[];
  score?: number;
  cost?: string;
}): Promise<string> {
  const rows = await ds.query<{ id: string }[]>(
    `INSERT INTO contacts (workspace_id, name) VALUES ($1, 'Visitor') RETURNING id`,
    [workspaceId],
  );
  const contactId = rows[0]?.id ?? '';
  const conversation = await ds.query<{ id: string }[]>(
    `INSERT INTO conversations
       (workspace_id, bot_id, contact_id, status, created_at, last_message_at,
        handoff_requested_at, closed_at, csat_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      workspaceId,
      botId,
      contactId,
      input.status,
      input.createdAt,
      input.lastMessageAt ?? input.createdAt,
      input.handoffAt ?? null,
      input.closedAt ?? null,
      input.score ?? null,
    ],
  );
  const conversationId = conversation[0]?.id ?? '';
  await ds.query(
    `INSERT INTO messages (workspace_id, conversation_id, role, content, created_at)
     VALUES ($1, $2, 'visitor', 'Question', $3)`,
    [workspaceId, conversationId, input.createdAt],
  );
  if (input.ai !== undefined) {
    await ds.query(
      `INSERT INTO messages (workspace_id, conversation_id, role, content, feedback, created_at)
       VALUES ($1, $2, 'ai', $3, $4, $5)`,
      [
        workspaceId,
        conversationId,
        input.ai.content ?? 'Answer',
        input.ai.feedback ?? null,
        input.createdAt,
      ],
    );
  }
  for (const [index, agentAt] of (input.agentAt ?? []).entries()) {
    await ds.query(
      `INSERT INTO messages (workspace_id, conversation_id, role, content, created_at)
       VALUES ($1, $2, 'agent', $3, $4)`,
      [workspaceId, conversationId, `Reply ${String(index + 1)}`, agentAt],
    );
  }
  if (input.cost !== undefined) {
    await ds.query(
      `INSERT INTO generation_traces
         (workspace_id, bot_id, conversation_id, origin, decision, cost_usd, created_at)
       VALUES ($1, $2, $3, 'widget', 'answered', $4, $5)`,
      [workspaceId, botId, conversationId, input.cost, input.createdAt],
    );
  }
  return conversationId;
}

beforeAll(async () => {
  ds = await getTestDataSource();
  service = new OutcomesService(new OutcomesRepository(ds), new FixedClock(NOW));
});

beforeEach(async () => {
  await resetDatabase(ds);
  const { user: owner } = await createUser({ ds }, { email: 'outcomes-owner@example.com' });
  const { user: otherOwner } = await createUser({ ds }, { email: 'outcomes-other@example.com' });
  workspaceId = asWorkspaceId((await createWorkspace({ ds }, owner, 'Outcomes')).id);
  otherWorkspaceId = asWorkspaceId((await createWorkspace({ ds }, otherOwner, 'Other')).id);
  botId = await createBot(workspaceId, 'primary');
  otherBotId = await createBot(otherWorkspaceId, 'other');
});

describe('OutcomesService', () => {
  it('returns a complete zero report and null rates for an empty range', async () => {
    const report = await service.compute(workspaceId, { from: '2026-11-01', to: '2026-11-02' });
    expect(report).toMatchObject({
      conversations: 0,
      pending: 0,
      aiResolved: 0,
      handedOff: 0,
      handoffRate: null,
      aiResolutionRate: null,
      firstHumanResponse: { medianSeconds: null, p90Seconds: null, unanswered: 0 },
      resolutionTime: { medianSeconds: null, p90Seconds: null },
      csat: { satisfiedRate: null, averageScore: null, responseRate: null, ratings: 0 },
      costPerResolvedUsd: null,
      daily: [
        { day: '2026-11-01', conversations: 0, aiResolved: 0, handedOff: 0 },
        { day: '2026-11-02', conversations: 0, aiResolved: 0, handedOff: 0 },
      ],
    });
  });

  it('matches the resolution, handoff, response, resolution-time, CSAT and cost definitions', async () => {
    await addConversation({
      status: 'closed',
      createdAt: '2026-11-10T08:00:00Z',
      closedAt: '2026-11-10T09:00:00Z',
      ai: {},
      score: 5,
      cost: '0.500000',
    });
    await addConversation({
      status: 'ai',
      createdAt: '2026-11-11T11:00:00Z',
      lastMessageAt: '2026-11-20T11:30:00Z',
    });
    await addConversation({
      status: 'closed',
      createdAt: '2026-11-12T08:00:00Z',
      handoffAt: '2026-11-12T09:00:00Z',
      closedAt: '2026-11-12T12:00:00Z',
      agentAt: ['2026-11-12T10:00:00Z', '2026-11-12T11:00:00Z'],
      score: 4,
      cost: '0.300000',
    });
    await addConversation({
      status: 'needs_human',
      createdAt: '2026-11-13T08:00:00Z',
      handoffAt: '2026-11-13T09:00:00Z',
      lastMessageAt: '2026-11-13T09:00:00Z',
      cost: '0.200000',
    });
    await addConversation({
      status: 'closed',
      createdAt: '2026-11-14T08:00:00Z',
      closedAt: '2026-11-14T09:00:00Z',
      ai: { feedback: -1 },
      score: 2,
      cost: '0.100000',
    });
    await addConversation({
      status: 'closed',
      createdAt: '2026-11-15T08:00:00Z',
      closedAt: '2026-11-15T09:00:00Z',
      ai: {},
      cost: '0.100000',
    });

    const report = await service.compute(workspaceId, { from: '2026-11-10', to: '2026-11-15' });
    expect(report).toMatchObject({
      conversations: 6,
      pending: 1,
      aiResolved: 2,
      handedOff: 2,
      handoffRate: 2 / 6,
      aiResolutionRate: 0.5,
      firstHumanResponse: { medianSeconds: 3600, p90Seconds: 3600, unanswered: 1 },
      resolutionTime: { medianSeconds: 10800, p90Seconds: 10800 },
      csat: { satisfiedRate: 2 / 3, averageScore: 11 / 3, responseRate: 0.75, ratings: 3 },
      costPerResolvedUsd: '0.400000',
      daily: [
        { day: '2026-11-10', conversations: 1, aiResolved: 1, handedOff: 0 },
        { day: '2026-11-11', conversations: 1, aiResolved: 0, handedOff: 0 },
        { day: '2026-11-12', conversations: 1, aiResolved: 0, handedOff: 1 },
        { day: '2026-11-13', conversations: 1, aiResolved: 0, handedOff: 1 },
        { day: '2026-11-14', conversations: 1, aiResolved: 0, handedOff: 0 },
        { day: '2026-11-15', conversations: 1, aiResolved: 1, handedOff: 0 },
      ],
    });

    await ds.query(`UPDATE messages SET feedback = 1 WHERE feedback = -1`);
    await expect(
      service.compute(workspaceId, { from: '2026-11-10', to: '2026-11-15' }),
    ).resolves.toMatchObject({ aiResolved: 3, aiResolutionRate: 0.6 });
  });

  it('rejects a foreign workspace bot and a query longer than 92 days', async () => {
    await expect(
      service.compute(workspaceId, { from: '2026-11-01', to: '2026-11-02', botId: otherBotId }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(outcomesQuerySchema.safeParse({ from: '2026-01-01', to: '2026-04-03' }).success).toBe(
      false,
    );
  });

  it('filters counts and costs to the requested bot and workspace', async () => {
    await addConversation({ status: 'closed', createdAt: '2026-11-10T08:00:00Z', ai: {} });
    const foreignContact = await ds.query<{ id: string }[]>(
      `INSERT INTO contacts (workspace_id, name) VALUES ($1, 'Foreign') RETURNING id`,
      [otherWorkspaceId],
    );
    const foreignConversation = await ds.query<{ id: string }[]>(
      `INSERT INTO conversations (workspace_id, bot_id, contact_id, status, created_at, closed_at)
       VALUES ($1, $2, $3, 'closed', '2026-11-10T08:00:00Z', '2026-11-10T09:00:00Z') RETURNING id`,
      [otherWorkspaceId, otherBotId, foreignContact[0]?.id],
    );
    await ds.query(
      `INSERT INTO messages (workspace_id, conversation_id, role, content)
       VALUES ($1, $2, 'visitor', 'Other question'), ($1, $2, 'ai', 'Other answer')`,
      [otherWorkspaceId, foreignConversation[0]?.id],
    );

    expect(
      await service.compute(workspaceId, {
        from: '2026-11-10',
        to: '2026-11-10',
        botId,
      }),
    ).toMatchObject({ conversations: 1, aiResolved: 1, daily: [{ conversations: 1 }] });
  });
});
