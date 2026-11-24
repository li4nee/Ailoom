// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../../../test/helpers/app';
import { resetDatabase } from '../../../test/helpers/db';
import { authed, createUser, createWorkspace, loginAs } from '../../../test/helpers/factories';
import { asWorkspaceId } from '../../db/ids';

interface ErrorBody {
  error: { code: string };
}

interface SuggestionBody {
  id: string;
  status: string;
  question: string;
  answer: string;
  sourceId: string | null;
}

let t: TestApp;
let owner: ReturnType<typeof authed>;
let agent: ReturnType<typeof authed>;
let workspaceId: string;
let botId: string;
let conversationId: string;
let aiMessageId: string;

async function createBot(): Promise<string> {
  const credentials = await t.ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', 'Correction chat'), ($1, 'mock', 'Correction embed') RETURNING id`,
    [workspaceId],
  );
  const rows = await t.ds.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim)
     VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'mock-embed', 384) RETURNING id`,
    [workspaceId, `pk_approval_${String(Date.now())}`, credentials[0]?.id, credentials[1]?.id],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('bot insert returned no id');
  return id;
}

async function createConversation(): Promise<void> {
  const contact = await t.ds.query<{ id: string }[]>(
    `INSERT INTO contacts (workspace_id, name) VALUES ($1, 'Visitor') RETURNING id`,
    [workspaceId],
  );
  const conversation = await t.ds.query<{ id: string }[]>(
    `INSERT INTO conversations (workspace_id, bot_id, contact_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [workspaceId, botId, contact[0]?.id],
  );
  const conversationRowId = conversation[0]?.id;
  if (conversationRowId === undefined) throw new Error('conversation insert returned no id');
  conversationId = conversationRowId;
  const messages = await t.ds.query<{ id: string; role: string }[]>(
    `INSERT INTO messages (workspace_id, conversation_id, role, content)
     VALUES ($1, $2, 'visitor', 'How do I reset my password?'),
            ($1, $2, 'ai', 'Click account settings.') RETURNING id, role`,
    [workspaceId, conversationId],
  );
  aiMessageId = messages.find((message) => message.role === 'ai')?.id ?? '';
}

async function createSuggestion(): Promise<SuggestionBody> {
  const response = await agent
    .post(
      `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages/${aiMessageId}/review`,
    )
    .send({
      verdict: 'incorrect',
      question: 'How do I reset my password?',
      answer: '<img src=x onerror=alert(1)> Use Account → Password.',
    });
  expect(response.status).toBe(201);
  return (response.body as { suggestion: SuggestionBody }).suggestion;
}

describe('knowledge suggestion approval', () => {
  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    const { user: ownerUser, password: ownerPassword } = await createUser(
      { ds: t.ds },
      { email: 'suggestion-approval-owner@example.com', name: 'Owner' },
    );
    const { user: agentUser, password: agentPassword } = await createUser(
      { ds: t.ds },
      { email: 'suggestion-approval-agent@example.com', name: 'Agent' },
    );
    const workspace = await createWorkspace(t, ownerUser, 'Suggestions approval');
    workspaceId = asWorkspaceId(workspace.id);
    await t.ds.query(
      `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agent')`,
      [workspaceId, agentUser.id],
    );
    owner = authed(t, await loginAs(t, ownerUser, ownerPassword));
    agent = authed(t, await loginAs(t, agentUser, agentPassword));
    botId = await createBot();
    await createConversation();
  });

  it('creates one text source transactionally and returns it on repeated or concurrent approve', async () => {
    const suggestion = await createSuggestion();
    const path = `/api/v1/workspaces/${workspaceId}/knowledge/suggestions/${suggestion.id}/approve`;

    const [first, concurrent] = await Promise.all([
      owner.post(path).send({}),
      owner.post(path).send({}),
    ]);
    expect(first.status).toBe(201);
    expect(concurrent.status).toBe(201);
    const firstSourceId = (first.body as { sourceId: string }).sourceId;
    const concurrentSourceId = (concurrent.body as { sourceId: string }).sourceId;
    expect(concurrentSourceId).toBe(firstSourceId);
    const repeat = await owner.post(path).send({});
    expect(repeat.status).toBe(201);
    expect((repeat.body as { sourceId: string }).sourceId).toBe(firstSourceId);

    const sourceRows = await t.ds.query<
      { id: string; type: string; title: string; options: Record<string, unknown> }[]
    >(
      `SELECT id, type, title, options FROM knowledge_sources WHERE workspace_id = $1 AND bot_id = $2`,
      [workspaceId, botId],
    );
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]).toMatchObject({
      id: firstSourceId,
      type: 'text',
      title: 'Correction: How do I reset my password?',
      options: {
        body: 'Question: How do I reset my password?\n\nAnswer: <img src=x onerror=alert(1)> Use Account → Password.',
      },
    });
    const jobs = await t.ds.query<{ name: string }[]>(
      `SELECT name FROM pgboss.job WHERE data->>'sourceId' = $1`,
      [firstSourceId],
    );
    expect(jobs.map((job) => job.name)).toEqual(['knowledge.ingest_source']);
    const audits = await t.ds.query<{ action: string }[]>(
      `SELECT action FROM audit_log WHERE workspace_id = $1 AND target_id = $2
       AND action = 'knowledge.suggestion_reviewed'`,
      [workspaceId, suggestion.id],
    );
    expect(audits).toHaveLength(1);
  });

  it('allows editing title, question and answer while approving', async () => {
    const suggestion = await createSuggestion();
    const response = await owner
      .post(`/api/v1/workspaces/${workspaceId}/knowledge/suggestions/${suggestion.id}/approve`)
      .send({ title: 'Password help', question: 'Updated question', answer: 'Updated answer' });
    expect(response.status).toBe(201);
    const result = response.body as { suggestion: SuggestionBody; sourceId: string };
    expect(result.suggestion).toMatchObject({
      status: 'approved',
      question: 'Updated question',
      answer: 'Updated answer',
      sourceId: result.sourceId,
    });
    const source = await t.ds.query<{ title: string; options: Record<string, unknown> }[]>(
      `SELECT title, options FROM knowledge_sources WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, result.sourceId],
    );
    expect(source[0]).toMatchObject({
      title: 'Password help',
      options: { body: 'Question: Updated question\n\nAnswer: Updated answer' },
    });
  });

  it('rejects an unavailable bot and leaves the suggestion pending', async () => {
    const suggestion = await createSuggestion();
    await t.ds.query(`UPDATE bots SET deleted_at = now() WHERE workspace_id = $1 AND id = $2`, [
      workspaceId,
      botId,
    ]);
    const response = await owner
      .post(`/api/v1/workspaces/${workspaceId}/knowledge/suggestions/${suggestion.id}/approve`)
      .send({});
    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).error.code).toBe('conflict');
    const row = await t.ds.query<{ status: string; source_id: string | null }[]>(
      `SELECT status, source_id FROM knowledge_suggestions WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, suggestion.id],
    );
    expect(row).toEqual([{ status: 'pending', source_id: null }]);
  });

  it('rejects with a reason, keeps the suggestion, and denies an agent approval', async () => {
    const suggestion = await createSuggestion();
    const agentApproval = await agent
      .post(`/api/v1/workspaces/${workspaceId}/knowledge/suggestions/${suggestion.id}/approve`)
      .send({});
    expect(agentApproval.status).toBe(403);
    const rejected = await owner
      .post(`/api/v1/workspaces/${workspaceId}/knowledge/suggestions/${suggestion.id}/reject`)
      .send({ reason: 'The proposed answer is inaccurate.' });
    expect(rejected.status).toBe(201);
    expect((rejected.body as { suggestion: SuggestionBody }).suggestion.status).toBe('rejected');
    const row = await t.ds.query<{ status: string; reject_reason: string | null }[]>(
      `SELECT status, reject_reason FROM knowledge_suggestions WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, suggestion.id],
    );
    expect(row).toEqual([
      { status: 'rejected', reject_reason: 'The proposed answer is inaccurate.' },
    ]);
  });

  it('lists suggestions by status and bot with cursor pagination', async () => {
    const first = await createSuggestion();
    await createConversation();
    const second = await createSuggestion();
    const list = await owner.get(
      `/api/v1/workspaces/${workspaceId}/knowledge/suggestions?status=pending&botId=${botId}&limit=1`,
    );
    expect(list.status).toBe(200);
    expect((list.body as { data: SuggestionBody[]; nextCursor: string | null }).data).toHaveLength(
      1,
    );
    const page = list.body as { data: SuggestionBody[]; nextCursor: string | null };
    expect([first.id, second.id]).toContain(page.data[0]?.id);
    expect(page.nextCursor).not.toBeNull();
    const next = await owner.get(
      `/api/v1/workspaces/${workspaceId}/knowledge/suggestions?status=pending&botId=${botId}&limit=1&cursor=${encodeURIComponent(String(page.nextCursor))}`,
    );
    expect((next.body as { data: SuggestionBody[] }).data).toHaveLength(1);
    expect((next.body as { data: SuggestionBody[] }).data[0]?.id).not.toBe(page.data[0]?.id);
  });
});
