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

const ALLOWED = 'https://shop.com';

let emailSeq = 0;

describe('widget handoff and feedback', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let workspaceId: string;
  let chatCredentialId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    emailSeq += 1;
    const { user, password } = await createUser(
      { ds: t.ds },
      { email: `h${String(emailSeq)}@example.com` },
    );
    workspaceId = (await createWorkspace(t, user, 'Acme')).id;
    owner = authed(t, await loginAs(t, user, password));
    await t.ds.query(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'local', 'Built-in (local)')`,
      [workspaceId],
    );
    const credential = await owner
      .post(`/api/v1/workspaces/${workspaceId}/credentials`)
      .send({ provider: 'mock', label: 'Chat' });
    chatCredentialId = (credential.body as { id: string }).id;
  });

  async function createBot(
    overrides: Record<string, unknown> = {},
  ): Promise<{ publicKey: string }> {
    const res = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
      name: 'Help',
      chatCredentialId,
      chatModel: 'mock-chat',
      allowedOrigins: [ALLOWED],
      ...overrides,
    });
    if (res.status !== 201) throw new Error(`bot create failed with ${String(res.status)}`);
    return res.body as { publicKey: string };
  }

  async function session(bot: {
    publicKey: string;
  }): Promise<{ token: string; contactId: string }> {
    const res = await t.http
      .post('/api/widget/v1/sessions')
      .set('Origin', ALLOWED)
      .send({ publicKey: bot.publicKey });
    if (res.status !== 201) throw new Error('session create failed');
    return res.body as { token: string; contactId: string };
  }

  async function conversation(token: string): Promise<string> {
    const res = await t.http
      .post('/api/widget/v1/conversations')
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    if (res.status !== 201) throw new Error('conversation create failed');
    return (res.body as { id: string }).id;
  }

  async function insertMessage(
    conversationId: string,
    role: 'visitor' | 'ai' | 'system',
  ): Promise<string> {
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO messages (workspace_id, conversation_id, role, content, status)
       VALUES ($1, $2, $3, 'hello', 'complete') RETURNING id`,
      [workspaceId, conversationId, role],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('message insert returned no id');
    return id;
  }

  function handoff(token: string, conversationId: string, body: unknown) {
    return t.http
      .post(`/api/widget/v1/conversations/${conversationId}/handoff`)
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function feedback(token: string, messageId: string, body: unknown) {
    return t.http
      .post(`/api/widget/v1/messages/${messageId}/feedback`)
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('moves the conversation to needs_human, stores the email and returns the message', async () => {
    const bot = await createBot();
    const { token, contactId } = await session(bot);
    const conversationId = await conversation(token);

    const res = await handoff(token, conversationId, { email: 'visitor@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'needs_human' });
    expect((res.body as { handoffMessage: string }).handoffMessage.length).toBeGreaterThan(0);

    const contact = await t.ds.query<{ email: string | null }[]>(
      `SELECT email FROM contacts WHERE id = $1`,
      [contactId],
    );
    expect(contact[0]?.email).toBe('visitor@example.com');

    const row = await t.ds.query<
      { status: string; handoff_reason: string | null; handoff_requested_at: Date | null }[]
    >(`SELECT status, handoff_reason, handoff_requested_at FROM conversations WHERE id = $1`, [
      conversationId,
    ]);
    expect(row[0]?.status).toBe('needs_human');
    expect(row[0]?.handoff_reason).toBe('visitor_request');
    expect(row[0]?.handoff_requested_at).not.toBeNull();

    const system = await t.ds.query<{ content: string }[]>(
      `SELECT content FROM messages WHERE conversation_id = $1 AND role = 'system'`,
      [conversationId],
    );
    expect(system).toEqual([{ content: 'Visitor asked to talk to a person.' }]);
  });

  it('is idempotent: a repeated handoff writes one system message', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await conversation(token);

    expect((await handoff(token, conversationId, {})).status).toBe(200);
    expect((await handoff(token, conversationId, {})).status).toBe(200);

    const system = await t.ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM messages
        WHERE conversation_id = $1 AND role = 'system'`,
      [conversationId],
    );
    expect(system[0]?.count).toBe(1);
  });

  it('keeps the conversation with an agent when it is already human', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await conversation(token);
    await t.ds.query(`UPDATE conversations SET status = 'human' WHERE id = $1`, [conversationId]);

    const res = await handoff(token, conversationId, {});

    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('human');
    const row = await t.ds.query<{ status: string }[]>(
      `SELECT status FROM conversations WHERE id = $1`,
      [conversationId],
    );
    expect(row[0]?.status).toBe('human');
  });

  it('rejects handoff when the bot has it disabled', async () => {
    const bot = await createBot({ handoffEnabled: false });
    const { token } = await session(bot);
    const conversationId = await conversation(token);

    const res = await handoff(token, conversationId, {});

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'handoff_disabled' } });
  });

  it('stores a thumbs up on an AI message and allows changing it', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await conversation(token);
    const messageId = await insertMessage(conversationId, 'ai');

    expect((await feedback(token, messageId, { rating: 1 })).status).toBe(204);
    expect((await feedback(token, messageId, { rating: -1 })).status).toBe(204);

    const row = await t.ds.query<{ feedback: number; feedback_at: Date | null }[]>(
      `SELECT feedback, feedback_at FROM messages WHERE id = $1`,
      [messageId],
    );
    expect(row[0]?.feedback).toBe(-1);
    expect(row[0]?.feedback_at).not.toBeNull();
  });

  it('404s feedback on a visitor message', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await conversation(token);
    const messageId = await insertMessage(conversationId, 'visitor');

    const res = await feedback(token, messageId, { rating: 1 });

    expect(res.status).toBe(404);
  });

  it("404s feedback on another contact's message", async () => {
    const bot = await createBot();
    const first = await session(bot);
    const second = await session(bot);
    const otherConversation = await conversation(second.token);
    const messageId = await insertMessage(otherConversation, 'ai');

    const res = await feedback(first.token, messageId, { rating: 1 });

    expect(res.status).toBe(404);
  });

  it('rejects a rating other than 1 or -1', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await conversation(token);
    const messageId = await insertMessage(conversationId, 'ai');

    const res = await feedback(token, messageId, { rating: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
  });
});
