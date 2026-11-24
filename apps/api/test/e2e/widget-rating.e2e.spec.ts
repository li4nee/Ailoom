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

describe('widget conversation rating', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let workspaceId: string;
  let chatCredentialId: string;
  let emailSeq = 0;

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
      { email: `rating-${String(emailSeq)}@example.com` },
    );
    workspaceId = (await createWorkspace(t, user, 'Ratings')).id;
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

  async function createBot(csatEnabled = true): Promise<{ publicKey: string }> {
    const response = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
      name: 'Help',
      chatCredentialId,
      chatModel: 'mock-chat',
      allowedOrigins: [ALLOWED],
      csatEnabled,
    });
    if (response.status !== 201) throw new Error(`bot create failed: ${String(response.status)}`);
    return response.body as { publicKey: string };
  }

  async function session(publicKey: string): Promise<string> {
    const response = await t.http
      .post('/api/widget/v1/sessions')
      .set('Origin', ALLOWED)
      .send({ publicKey });
    if (response.status !== 201) throw new Error('session create failed');
    return (response.body as { token: string }).token;
  }

  async function conversation(token: string): Promise<string> {
    const response = await t.http
      .post('/api/widget/v1/conversations')
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    if (response.status !== 201) throw new Error('conversation create failed');
    return (response.body as { id: string }).id;
  }

  function rate(token: string, conversationId: string, body: Record<string, unknown>) {
    return t.http
      .post(`/api/widget/v1/conversations/${conversationId}/rating`)
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function closeConversation(conversationId: string): Promise<void> {
    await t.ds.query(
      `UPDATE conversations SET status = 'closed', closed_at = now() WHERE id = $1`,
      [conversationId],
    );
  }

  it('stores one rating and optional comment for a closed conversation', async () => {
    const bot = await createBot();
    const token = await session(bot.publicKey);
    const conversationId = await conversation(token);
    await closeConversation(conversationId);

    const response = await rate(token, conversationId, { score: 5, comment: 'Great support.' });

    expect(response.status).toBe(204);
    const rows = await t.ds.query<{ csat_score: number; csat_comment: string; csat_at: Date }[]>(
      `SELECT csat_score, csat_comment, csat_at FROM conversations WHERE id = $1`,
      [conversationId],
    );
    expect(rows[0]).toMatchObject({ csat_score: 5, csat_comment: 'Great support.' });
    expect(rows[0]?.csat_at).toBeInstanceOf(Date);
  });

  it('rejects a second rating and a rating before the conversation closes', async () => {
    const bot = await createBot();
    const token = await session(bot.publicKey);
    const conversationId = await conversation(token);

    expect((await rate(token, conversationId, { score: 4 })).status).toBe(409);
    await closeConversation(conversationId);
    expect((await rate(token, conversationId, { score: 4 })).status).toBe(204);
    const second = await rate(token, conversationId, { score: 2 });

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'conflict' } });
  });

  it('hides the route when CSAT is disabled and from another visitor', async () => {
    const disabledBot = await createBot(false);
    const disabledToken = await session(disabledBot.publicKey);
    const disabledConversation = await conversation(disabledToken);
    await closeConversation(disabledConversation);
    expect((await rate(disabledToken, disabledConversation, { score: 5 })).status).toBe(404);

    const bot = await createBot();
    const ownerToken = await session(bot.publicKey);
    const foreignToken = await session(bot.publicKey);
    const foreignConversation = await conversation(foreignToken);
    await closeConversation(foreignConversation);
    expect((await rate(ownerToken, foreignConversation, { score: 5 })).status).toBe(404);
  });

  it('rejects scores outside 1–5 and comments over 1000 characters', async () => {
    const bot = await createBot();
    const token = await session(bot.publicKey);
    const conversationId = await conversation(token);
    await closeConversation(conversationId);

    expect((await rate(token, conversationId, { score: 0 })).status).toBe(400);
    expect((await rate(token, conversationId, { score: 6 })).status).toBe(400);
    expect(
      (await rate(token, conversationId, { score: 5, comment: 'x'.repeat(1001) })).status,
    ).toBe(400);
  });
});
