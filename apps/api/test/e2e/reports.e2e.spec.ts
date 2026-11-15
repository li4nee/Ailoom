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

interface UsageBody {
  days: {
    day: string;
    conversations: number;
    visitorMessages: number;
    aiMessages: number;
    escalations: number;
    inputTokens: number;
    outputTokens: number;
    embeddingTokens: number;
    costUsd: string;
  }[];
  totals: Omit<UsageBody['days'][number], 'day'>;
  feedback: { positive: number; negative: number; positiveRate: number | null };
  monthToDate: { costUsd: string; capUsd: string } | null;
}

interface PageBody<T> {
  data: T[];
  nextCursor: string | null;
}

let emailSeq = 0;

describe('usage and quality reports', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let agent: AuthedClient;
  let workspaceId: string;
  let botId: string;
  let secondBotId: string;
  let conversationId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    emailSeq += 1;
    const ownerAccount = await createUser(
      { ds: t.ds },
      { email: `rep-owner${String(emailSeq)}@example.com`, name: 'Olivia Owner' },
    );
    const workspace = await createWorkspace(t, ownerAccount.user, 'Acme');
    workspaceId = workspace.id;
    owner = authed(t, await loginAs(t, ownerAccount.user, ownerAccount.password));

    const agentAccount = await createUser(
      { ds: t.ds },
      { email: `rep-agent${String(emailSeq)}@example.com`, name: 'Alex Agent' },
    );
    await addMember(t, workspace, agentAccount.user, 'agent');
    agent = authed(t, await loginAs(t, agentAccount.user, agentAccount.password));

    const credentials = await t.ds.query<{ id: string }[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'mock', 'Chat'), ($1, 'mock', 'Embed') RETURNING id`,
      [workspaceId],
    );
    const [chat, embed] = credentials.map((row) => row.id);
    async function bot(name: string, cap: string | null): Promise<string> {
      const rows = await t.ds.query<{ id: string }[]>(
        `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                           embedding_credential_id, embedding_model, embedding_dim,
                           no_answer_behavior, monthly_spend_cap_usd)
         VALUES ($1, $2, $3, $4, 'mock-chat', $5, 'mock-embed', 384, 'offer_handoff', $6)
         RETURNING id`,
        [workspaceId, name, `pk_rep_${name}_${String(emailSeq)}`, chat, embed, cap],
      );
      return rows[0]?.id ?? '';
    }
    botId = await bot('Help', '10.00');
    secondBotId = await bot('Sales', null);

    const contacts = await t.ds.query<{ id: string }[]>(
      `INSERT INTO contacts (workspace_id, email) VALUES ($1, 'visitor@example.com') RETURNING id`,
      [workspaceId],
    );
    const conversations = await t.ds.query<{ id: string }[]>(
      `INSERT INTO conversations (workspace_id, bot_id, contact_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [workspaceId, botId, contacts[0]?.id],
    );
    conversationId = conversations[0]?.id ?? '';
  });

  function today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  }

  it('returns every day in range, totals equal the sum, and month-to-date against a cap', async () => {
    const day = today();
    await t.ds.query(
      `INSERT INTO usage_daily
         (workspace_id, bot_id, day, conversations, visitor_messages, ai_messages, escalations,
          input_tokens, output_tokens, embedding_tokens, cost_usd)
       VALUES
         ($1, $2, $3, 2, 5, 4, 1, 100, 40, 7, 1.500000),
         ($1, $4, $3, 1, 2, 0, 0, 20, 0, 0, 2.250000)`,
      [workspaceId, botId, day, secondBotId],
    );

    const res = await owner.get(
      `/api/v1/workspaces/${workspaceId}/usage?from=${daysAgo(2)}&to=${day}`,
    );

    expect(res.status).toBe(200);
    const body = res.body as UsageBody;
    expect(body.days).toHaveLength(3);
    expect(body.days.map((row) => row.day)).toEqual([daysAgo(2), daysAgo(1), day]);
    expect(body.days[0]).toMatchObject({ conversations: 0, costUsd: '0.000000' });
    expect(body.days[2]).toMatchObject({
      conversations: 3,
      visitorMessages: 7,
      aiMessages: 4,
      escalations: 1,
      inputTokens: 120,
      outputTokens: 40,
      embeddingTokens: 7,
      costUsd: '3.750000',
    });
    expect(body.totals).toEqual({
      conversations: 3,
      visitorMessages: 7,
      aiMessages: 4,
      escalations: 1,
      inputTokens: 120,
      outputTokens: 40,
      embeddingTokens: 7,
      costUsd: '3.750000',
    });
    expect(body.feedback).toEqual({ positive: 0, negative: 0, positiveRate: null });
    expect(body.monthToDate).toEqual({ costUsd: '3.750000', capUsd: '10.000000' });
  });

  it('counts playground cost and feedback without inventing conversations', async () => {
    const day = today();
    await t.ds.query(
      `INSERT INTO usage_daily
         (workspace_id, bot_id, day, conversations, input_tokens, output_tokens, cost_usd)
       VALUES ($1, $2, $3, 0, 10, 5, 0.000500)`,
      [workspaceId, botId, day],
    );
    await t.ds.query(
      `INSERT INTO messages (workspace_id, conversation_id, role, content, feedback, feedback_at)
       VALUES ($1, $2, 'ai', 'Loved it', 1, now()), ($1, $2, 'ai', 'Hated it', -1, now())`,
      [workspaceId, conversationId],
    );

    const res = await agent.get(
      `/api/v1/workspaces/${workspaceId}/usage?from=${day}&to=${day}&botId=${botId}`,
    );

    expect(res.status).toBe(200);
    const body = res.body as UsageBody;
    expect(body.totals.conversations).toBe(0);
    expect(body.totals.costUsd).toBe('0.000500');
    expect(body.feedback).toEqual({ positive: 1, negative: 1, positiveRate: 0.5 });
    expect(body.monthToDate?.capUsd).toBe('10.000000');
  });

  it('rejects a range longer than 366 days', async () => {
    const res = await owner.get(
      `/api/v1/workspaces/${workspaceId}/usage?from=2025-01-01&to=2026-01-02`,
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('lists only knowledge-gap escalations from the widget, with a stable cursor', async () => {
    const trigger = async (content: string): Promise<string> => {
      const rows = await t.ds.query<{ id: string }[]>(
        `INSERT INTO messages (workspace_id, conversation_id, role, content)
         VALUES ($1, $2, 'visitor', $3) RETURNING id`,
        [workspaceId, conversationId, content],
      );
      return rows[0]?.id ?? '';
    };
    const trace = async (
      messageId: string,
      reason: string,
      origin: 'widget' | 'playground',
      topScore: number,
    ): Promise<void> => {
      await t.ds.query(
        `INSERT INTO generation_traces
           (workspace_id, bot_id, trigger_message_id, origin, decision, decision_reason, top_score)
         VALUES ($1, $2, $3, $4, 'escalated', $5, $6)`,
        [workspaceId, botId, messageId, origin, reason, topScore],
      );
    };

    const low = await trigger('How do refunds work?');
    const none = await trigger('Do you ship to Mars?');
    const intent = await trigger('I want a human');
    const playground = await trigger('Playground question');
    await trace(low, 'top_score_below_threshold', 'widget', 0.11);
    await trace(none, 'no_knowledge', 'widget', 0);
    await trace(intent, 'handoff_intent', 'widget', 0.9);
    await trace(playground, 'no_knowledge', 'playground', 0);

    const first = await owner.get(`/api/v1/workspaces/${workspaceId}/unanswered?limit=1`);

    expect(first.status).toBe(200);
    const page = first.body as PageBody<{
      messageId: string;
      conversationId: string;
      botId: string;
      content: string;
      topScore: number | null;
      createdAt: string;
    }>;
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.messageId).toBe(none);
    expect(page.data[0]).toMatchObject({
      conversationId,
      botId,
      content: 'Do you ship to Mars?',
      topScore: 0,
    });
    expect(page.nextCursor).not.toBeNull();

    const second = await owner.get(
      `/api/v1/workspaces/${workspaceId}/unanswered?limit=1&cursor=${page.nextCursor ?? ''}`,
    );
    const secondPage = second.body as PageBody<{ messageId: string }>;
    expect(secondPage.data.map((row) => row.messageId)).toEqual([low]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('lists negative feedback with the trace id', async () => {
    const message = await t.ds.query<{ id: string }[]>(
      `INSERT INTO messages (workspace_id, conversation_id, role, content, feedback, feedback_at)
       VALUES ($1, $2, 'ai', 'Wrong answer', -1, now()) RETURNING id`,
      [workspaceId, conversationId],
    );
    const messageId = message[0]?.id ?? '';
    const trace = await t.ds.query<{ id: string }[]>(
      `INSERT INTO generation_traces
         (workspace_id, bot_id, conversation_id, message_id, origin, decision)
       VALUES ($1, $2, $3, $4, 'widget', 'answered') RETURNING id`,
      [workspaceId, botId, conversationId, messageId],
    );

    const res = await owner.get(
      `/api/v1/workspaces/${workspaceId}/feedback?rating=-1&botId=${botId}`,
    );

    expect(res.status).toBe(200);
    const page = res.body as PageBody<{
      messageId: string;
      conversationId: string;
      content: string;
      traceId: string | null;
      feedbackAt: string | null;
    }>;
    expect(page.data).toEqual([
      {
        messageId,
        conversationId,
        content: 'Wrong answer',
        traceId: trace[0]?.id ?? '',
        feedbackAt: expect.any(String) as string,
      },
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('rejects reports for an agent who is not an admin', async () => {
    expect((await agent.get(`/api/v1/workspaces/${workspaceId}/unanswered`)).status).toBe(403);
    expect((await agent.get(`/api/v1/workspaces/${workspaceId}/feedback`)).status).toBe(403);
  });
});
