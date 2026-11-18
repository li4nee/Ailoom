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

interface ConversationItem {
  id: string;
  botId: string;
  botName: string;
  status: string;
  contact: { id: string; email: string | null; name: string | null };
  assignedTo: { id: string; name: string } | null;
  handoffReason: string | null;
  handoffRequestedAt: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  unansweredByHuman: boolean;
}

interface PageBody {
  data: ConversationItem[];
  nextCursor: string | null;
}

interface AdminMessage {
  id: string;
  role: string;
  content: string;
  citations: unknown[] | null;
  status: string;
  feedback: number | null;
  author: { id: string; name: string } | null;
  traceId: string | null;
  createdAt: string;
}

interface DetailBody {
  conversation: {
    id: string;
    botId: string;
    botName: string;
    status: string;
    assignedTo: { id: string; name: string } | null;
  };
  contact: {
    id: string;
    email: string | null;
    name: string | null;
    externalId: string | null;
    attributes: Record<string, unknown>;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  contactHistory: { id: string; status: string; priority: string }[];
  messages: AdminMessage[];
  handoffSummaryEnabled: boolean;
  handoffSummary: { id: string; state: string } | null;
  suggestedRepliesEnabled: boolean;
  suggestedReply: { id: string; state: string } | null;
}

interface CountsBody {
  needsHuman: number;
  mine: number;
}

interface MessageSeed {
  role: 'visitor' | 'ai' | 'agent' | 'system';
  content: string;
  createdAt: string;
  authorUserId?: string;
  feedback?: -1 | 1;
  trace?: { decision: 'answered' | 'escalated' };
}

interface ConversationSeed {
  botId: string;
  contactId: string;
  status: 'ai' | 'needs_human' | 'human' | 'closed';
  lastMessageAt: string;
  assignedUserId?: string;
  handoffReason?: 'visitor_request' | 'agent_takeover';
  handoffRequestedAt?: string;
  messages: MessageSeed[];
}

let emailSeq = 0;

function nextEmail(prefix = 'conversations'): string {
  emailSeq += 1;
  return `${prefix}${String(emailSeq)}@example.com`;
}

describe('conversations inbox', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let agent: AuthedClient;
  let workspaceId: string;
  let agentId: string;
  let botAId: string;
  let botBId: string;
  let buyerId: string;
  let guestId: string;

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
      { email: nextEmail('owner'), name: 'Olivia Owner' },
    );
    const workspace = await createWorkspace(t, ownerAccount.user, 'Acme');
    workspaceId = workspace.id;
    owner = authed(t, await loginAs(t, ownerAccount.user, ownerAccount.password));

    const agentAccount = await createUser(
      { ds: t.ds },
      { email: nextEmail('agent'), name: 'Alex Agent' },
    );
    agentId = agentAccount.user.id;
    await addMember(t, workspace, agentAccount.user, 'agent');
    agent = authed(t, await loginAs(t, agentAccount.user, agentAccount.password));

    const credentials = await t.ds.query<{ id: string }[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'mock', 'Chat'), ($1, 'mock', 'Embed')
       RETURNING id`,
      [workspaceId],
    );
    const [chatCredentialId, embeddingCredentialId] = credentials.map((row) => row.id);

    async function insertBot(name: string, publicKey: string): Promise<string> {
      const rows = await t.ds.query<{ id: string }[]>(
        `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                           embedding_credential_id, embedding_model, embedding_dim,
                           no_answer_behavior)
         VALUES ($1, $2, $3, $4, 'mock-chat', $5, 'mock-embed', 384, 'offer_handoff')
         RETURNING id`,
        [workspaceId, name, publicKey, chatCredentialId, embeddingCredentialId],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error('insertBot returned no id');
      return id;
    }

    botAId = await insertBot('Help', 'pk_live_conversations_help');
    botBId = await insertBot('Sales', 'pk_live_conversations_sales');

    buyerId = await seedContact('buyer@example.com', 'Bea Buyer');
    guestId = await seedContact(null, null);
  });

  async function seedContact(email: string | null, name: string | null): Promise<string> {
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO contacts (workspace_id, email, name) VALUES ($1, $2, $3) RETURNING id`,
      [workspaceId, email, name],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('seedContact returned no id');
    return id;
  }

  async function seedConversation(seed: ConversationSeed): Promise<string> {
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO conversations
         (workspace_id, bot_id, contact_id, status, assigned_user_id, handoff_reason,
          handoff_requested_at, last_message_at, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        workspaceId,
        seed.botId,
        seed.contactId,
        seed.status,
        seed.assignedUserId ?? null,
        seed.handoffReason ?? null,
        seed.handoffRequestedAt ?? null,
        seed.lastMessageAt,
        seed.status === 'closed' ? seed.lastMessageAt : null,
      ],
    );
    const conversationId = rows[0]?.id;
    if (conversationId === undefined) throw new Error('seedConversation returned no id');

    for (const message of seed.messages) {
      const inserted = await t.ds.query<{ id: string }[]>(
        `INSERT INTO messages
           (workspace_id, conversation_id, role, author_user_id, content, status,
            feedback, feedback_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 'complete', $6, $7, $8)
         RETURNING id`,
        [
          workspaceId,
          conversationId,
          message.role,
          message.authorUserId ?? null,
          message.content,
          message.feedback ?? null,
          message.feedback === undefined ? null : message.createdAt,
          message.createdAt,
        ],
      );
      const messageId = inserted[0]?.id;
      if (messageId === undefined) throw new Error('seedMessage returned no id');
      if (message.trace !== undefined) {
        await t.ds.query(
          `INSERT INTO generation_traces
             (workspace_id, bot_id, conversation_id, message_id, origin, decision)
           VALUES ($1, $2, $3, $4, 'widget', $5)`,
          [workspaceId, seed.botId, conversationId, messageId, message.trace.decision],
        );
      }
    }
    return conversationId;
  }

  function listUrl(query = ''): string {
    return `/api/v1/workspaces/${workspaceId}/conversations${query}`;
  }

  it('combines filters and maps the inbox row fields', async () => {
    const conversationId = await seedConversation({
      botId: botAId,
      contactId: buyerId,
      status: 'needs_human',
      assignedUserId: agentId,
      handoffReason: 'visitor_request',
      handoffRequestedAt: '2026-11-15T10:00:00.000Z',
      lastMessageAt: '2026-11-15T10:00:00.000Z',
      messages: [
        {
          role: 'visitor',
          content: 'Where is my refund?',
          createdAt: '2026-11-15T09:59:00.000Z',
        },
        {
          role: 'ai',
          content: 'Our refund policy is available in the help centre.',
          createdAt: '2026-11-15T10:00:00.000Z',
        },
      ],
    });
    await seedConversation({
      botId: botBId,
      contactId: buyerId,
      status: 'needs_human',
      lastMessageAt: '2026-11-15T11:00:00.000Z',
      messages: [
        { role: 'visitor', content: 'Can I buy more?', createdAt: '2026-11-15T11:00:00.000Z' },
      ],
    });

    const res = await agent.get(
      listUrl(`?botId=${botAId}&status=needs_human&assignedTo=me&q=refund`),
    );

    expect(res.status).toBe(200);
    const page = res.body as PageBody;
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      id: conversationId,
      botId: botAId,
      botName: 'Help',
      status: 'needs_human',
      contact: { id: buyerId, email: 'buyer@example.com', name: 'Bea Buyer' },
      assignedTo: { id: agentId, name: 'Alex Agent' },
      handoffReason: 'visitor_request',
      handoffRequestedAt: '2026-11-15T10:00:00.000Z',
      lastMessageAt: '2026-11-15T10:00:00.000Z',
      lastMessagePreview: 'Our refund policy is available in the help centre.',
      unansweredByHuman: false,
    });
    expect(page.nextCursor).toBeNull();
  });

  it('flags a conversation whose latest visitor message has no human reply', async () => {
    const conversationId = await seedConversation({
      botId: botAId,
      contactId: guestId,
      status: 'needs_human',
      assignedUserId: agentId,
      lastMessageAt: '2026-11-15T12:00:00.000Z',
      messages: [
        {
          role: 'visitor',
          content: 'I still need help with this order.',
          createdAt: '2026-11-15T12:00:00.000Z',
        },
      ],
    });

    const res = await owner.get(listUrl(`?status=needs_human`));

    expect(res.status).toBe(200);
    expect((res.body as PageBody).data[0]).toMatchObject({
      id: conversationId,
      unansweredByHuman: true,
      contact: { id: guestId, email: null, name: null },
      assignedTo: { id: agentId, name: 'Alex Agent' },
    });
  });

  it('sorts by last message time and id, and paginates without duplicates', async () => {
    const at = '2026-11-15T09:00:00.000Z';
    const first = await seedConversation({
      botId: botAId,
      contactId: buyerId,
      status: 'ai',
      lastMessageAt: at,
      messages: [{ role: 'visitor', content: 'First', createdAt: at }],
    });
    const second = await seedConversation({
      botId: botAId,
      contactId: buyerId,
      status: 'ai',
      lastMessageAt: at,
      messages: [{ role: 'visitor', content: 'Second', createdAt: at }],
    });
    const third = await seedConversation({
      botId: botAId,
      contactId: buyerId,
      status: 'ai',
      lastMessageAt: '2026-11-15T10:00:00.000Z',
      messages: [{ role: 'visitor', content: 'Third', createdAt: '2026-11-15T10:00:00.000Z' }],
    });

    const pageOne = await owner.get(listUrl('?limit=2'));
    expect(pageOne.status).toBe(200);
    const firstPage = pageOne.body as PageBody;
    expect(firstPage.data.map((row) => row.id)).toEqual([third, second]);
    expect(firstPage.nextCursor).not.toBeNull();

    const pageTwo = await owner.get(
      listUrl(`?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`),
    );
    expect(pageTwo.status).toBe(200);
    const secondPage = pageTwo.body as PageBody;
    expect(secondPage.data.map((row) => row.id)).toEqual([first]);
    expect(secondPage.nextCursor).toBeNull();
    expect(new Set([...firstPage.data, ...secondPage.data].map((row) => row.id)).size).toBe(3);
  });

  it('treats Postgres search syntax as plain words and matches email exactly', async () => {
    await seedConversation({
      botId: botAId,
      contactId: buyerId,
      status: 'ai',
      lastMessageAt: '2026-11-15T09:00:00.000Z',
      messages: [
        {
          role: 'visitor',
          content: 'refund policy and shipping details',
          createdAt: '2026-11-15T09:00:00.000Z',
        },
      ],
    });
    await seedConversation({
      botId: botAId,
      contactId: guestId,
      status: 'ai',
      lastMessageAt: '2026-11-15T08:00:00.000Z',
      messages: [
        {
          role: 'visitor',
          content: 'unrelated question',
          createdAt: '2026-11-15T08:00:00.000Z',
        },
      ],
    });

    for (const q of ['refund & !shipping', '"unbalanced', ':*', 'refund OR shipping']) {
      const res = await owner.get(listUrl(`?q=${encodeURIComponent(q)}`));
      expect(res.status).toBe(200);
    }

    const email = await owner.get(listUrl('?q=BUYER%40EXAMPLE.COM'));
    expect(email.status).toBe(200);
    const page = email.body as PageBody;
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.contact.email).toBe('buyer@example.com');
  });

  it('returns needs-human and assigned-to-me counts', async () => {
    await seedConversation({
      botId: botAId,
      contactId: buyerId,
      status: 'needs_human',
      assignedUserId: agentId,
      lastMessageAt: '2026-11-15T10:00:00.000Z',
      messages: [],
    });
    await seedConversation({
      botId: botBId,
      contactId: guestId,
      status: 'needs_human',
      lastMessageAt: '2026-11-15T11:00:00.000Z',
      messages: [],
    });
    await seedConversation({
      botId: botAId,
      contactId: buyerId,
      status: 'human',
      assignedUserId: agentId,
      lastMessageAt: '2026-11-15T12:00:00.000Z',
      messages: [],
    });

    const res = await agent.get(`/api/v1/workspaces/${workspaceId}/conversations/counts`);

    expect(res.status).toBe(200);
    expect(res.body as CountsBody).toEqual({ needsHuman: 2, mine: 2 });
  });

  it('returns the conversation, contact and every message with AI trace ids', async () => {
    const conversationId = await seedConversation({
      botId: botAId,
      contactId: buyerId,
      status: 'human',
      assignedUserId: agentId,
      lastMessageAt: '2026-11-15T10:05:00.000Z',
      messages: [
        {
          role: 'visitor',
          content: 'Where is my refund?',
          createdAt: '2026-11-15T10:00:00.000Z',
        },
        {
          role: 'ai',
          content: 'Refunds take five business days.',
          createdAt: '2026-11-15T10:01:00.000Z',
          trace: { decision: 'answered' },
        },
        {
          role: 'agent',
          authorUserId: agentId,
          content: 'I checked it for you.',
          createdAt: '2026-11-15T10:05:00.000Z',
        },
      ],
    });
    await t.ds.query(
      `UPDATE contacts SET external_id = 'customer-42', attributes = $2::jsonb WHERE workspace_id = $1 AND id = $3`,
      [workspaceId, JSON.stringify({ plan: 'pro', note: 'x'.repeat(900) }), buyerId],
    );
    const previousConversationId = await seedConversation({
      botId: botBId,
      contactId: buyerId,
      status: 'closed',
      lastMessageAt: '2026-11-14T10:00:00.000Z',
      messages: [],
    });

    const res = await agent.get(`${listUrl()}/${conversationId}`);

    expect(res.status).toBe(200);
    const body = res.body as DetailBody;
    expect(body.conversation).toMatchObject({
      id: conversationId,
      botId: botAId,
      botName: 'Help',
      status: 'human',
      assignedTo: { id: agentId, name: 'Alex Agent' },
    });
    expect(body.contact).toMatchObject({
      id: buyerId,
      email: 'buyer@example.com',
      name: 'Bea Buyer',
      externalId: 'customer-42',
      attributes: { plan: 'pro', note: 'x'.repeat(500) },
    });
    expect(body.contactHistory).toMatchObject([
      { id: previousConversationId, botName: 'Sales', status: 'closed' },
    ]);
    expect(body.messages.map((message) => message.role)).toEqual(['visitor', 'ai', 'agent']);
    expect(body.messages[1]).toMatchObject({
      content: 'Refunds take five business days.',
      author: null,
      traceId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
    });
    expect(body.messages[0]?.traceId).toBeNull();
    expect(body.messages[2]).toMatchObject({
      author: { id: agentId, name: 'Alex Agent' },
      traceId: null,
    });
    expect(body.handoffSummaryEnabled).toBe(false);
    expect(body.handoffSummary).toBeNull();
    expect(body.suggestedRepliesEnabled).toBe(false);
    expect(body.suggestedReply).toBeNull();
  });

  it('rejects suggested replies while the bot kill switch is off', async () => {
    const conversationId = await seedConversation({
      botId: botAId,
      contactId: buyerId,
      status: 'human',
      assignedUserId: agentId,
      lastMessageAt: '2026-11-15T10:00:00.000Z',
      messages: [
        { role: 'visitor', content: 'I need help.', createdAt: '2026-11-15T10:00:00.000Z' },
      ],
    });
    const response = await agent
      .post(
        `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/agent-assist/suggested-reply`,
      )
      .send({ idempotencyKey: crypto.randomUUID() });

    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe('validation_failed');
    const artifacts = await t.ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM conversation_ai_artifacts
        WHERE workspace_id = $1 AND conversation_id = $2 AND kind = 'suggested_reply'`,
      [workspaceId, conversationId],
    );
    expect(artifacts[0]?.count).toBe(0);
  });

  it('queues one owner-enabled handoff summary and returns the same active artifact for retries', async () => {
    const conversationId = await seedConversation({
      botId: botAId,
      contactId: buyerId,
      status: 'needs_human',
      handoffReason: 'visitor_request',
      lastMessageAt: '2026-11-15T12:00:00.000Z',
      messages: [
        {
          role: 'visitor',
          content: 'Please connect me to a person.',
          createdAt: '2026-11-15T12:00:00.000Z',
        },
      ],
    });
    await t.ds.query(
      `UPDATE bots SET agent_assist_enabled = true, automatic_handoff_summaries = true WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, botAId],
    );
    const path = `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/agent-assist/handoff-summary`;
    const first = await agent.post(path);
    const retry = await agent.post(path);
    const firstBody = first.body as { id: string; kind: string; state: string };
    const retryBody = retry.body as { id: string };

    expect(first.status).toBe(201);
    expect(firstBody).toMatchObject({ kind: 'handoff_summary', state: 'queued' });
    expect(retry.status).toBe(201);
    expect(retryBody.id).toBe(firstBody.id);
  });

  it('returns 404 for a non-member workspace', async () => {
    const conversationId = await seedConversation({
      botId: botAId,
      contactId: buyerId,
      status: 'ai',
      lastMessageAt: '2026-11-15T09:00:00.000Z',
      messages: [],
    });
    const outsider = await createUser({ ds: t.ds }, { email: nextEmail('outsider') });
    const outsiderWorkspace = await createWorkspace(t, outsider.user, 'Other');
    const outsiderClient = authed(t, await loginAs(t, outsider.user, outsider.password));

    const list = await outsiderClient.get(listUrl());
    expect(list.status).toBe(404);
    expect(
      (await outsiderClient.get(`/api/v1/workspaces/${workspaceId}/conversations/counts`)).status,
    ).toBe(404);

    const detail = await outsiderClient.get(
      `/api/v1/workspaces/${outsiderWorkspace.id}/conversations/${conversationId}`,
    );
    expect(detail.status).toBe(404);
  });
});
