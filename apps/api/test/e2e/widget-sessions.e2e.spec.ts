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

interface ErrorBody {
  error: { code: string };
}

interface Bot {
  id: string;
  publicKey: string;
}

interface Session {
  token: string;
  contactId: string;
}

interface Conversation {
  id: string;
  status: string;
  messages: unknown[];
}

const ALLOWED = 'https://shop.com';

let emailSeq = 0;

describe('widget sessions, config and conversations', () => {
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
      { email: `s${String(emailSeq)}@example.com` },
    );
    workspaceId = (await createWorkspace(t, user, 'Acme')).id;
    owner = authed(t, await loginAs(t, user, password));

    // The factory inserts the workspace directly, so `workspace.created` never fired.
    await t.ds.query(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'local', 'Built-in (local)')`,
      [workspaceId],
    );
    const credential = await owner
      .post(`/api/v1/workspaces/${workspaceId}/credentials`)
      .send({ provider: 'mock', label: 'Chat' });
    if (credential.status !== 201) {
      throw new Error(`credential create failed with ${String(credential.status)}`);
    }
    chatCredentialId = (credential.body as { id: string }).id;
  });

  function codeOf(body: unknown): string {
    return (body as ErrorBody).error.code;
  }

  async function createBot(): Promise<Bot> {
    const res = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
      name: 'Help',
      chatCredentialId,
      chatModel: 'mock-chat',
      allowedOrigins: [ALLOWED],
    });
    if (res.status !== 201) throw new Error(`bot create failed with ${String(res.status)}`);
    const body = res.body as Bot;
    return { id: body.id, publicKey: body.publicKey };
  }

  function createSession(publicKey: string, token?: string) {
    return t.http
      .post('/api/widget/v1/sessions')
      .set('Origin', ALLOWED)
      .send({ publicKey, ...(token === undefined ? {} : { token }) });
  }

  async function session(bot: Bot): Promise<Session> {
    const res = await createSession(bot.publicKey);
    if (res.status !== 201) throw new Error(`session create failed with ${String(res.status)}`);
    return res.body as Session;
  }

  function withVisitor(path: string, token: string) {
    return t.http.get(path).set('Origin', ALLOWED).set('Authorization', `Bearer ${token}`);
  }

  it('creates a contact on the first session', async () => {
    const bot = await createBot();

    const res = await createSession(bot.publicKey);

    expect(res.status).toBe(201);
    const body = res.body as Session;
    expect(body.contactId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.token.length).toBeGreaterThan(20);
    const rows = await t.ds.query<{ email: string | null }[]>(
      `SELECT email FROM contacts WHERE id = $1 AND workspace_id = $2`,
      [body.contactId, workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBeNull();
  });

  it('resumes the same contact when the saved token is sent', async () => {
    const bot = await createBot();
    const first = await session(bot);

    const res = await createSession(bot.publicKey, first.token);

    expect(res.status).toBe(201);
    expect((res.body as Session).contactId).toBe(first.contactId);
    const contacts = await t.ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM contacts WHERE workspace_id = $1`,
      [workspaceId],
    );
    expect(contacts[0]?.count).toBe(1);
  });

  it('identifies the current contact without merging another contact', async () => {
    const bot = await createBot();
    const first = await session(bot);

    const identified = await t.http
      .post('/api/widget/v1/contacts/identify')
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${first.token}`)
      .send({
        externalId: 'customer-42',
        email: 'buyer@example.com',
        name: 'Bea Buyer',
        attributes: { plan: 'pro' },
      });

    expect(identified.status).toBe(201);
    expect(identified.body).toMatchObject({
      contactId: first.contactId,
      externalId: 'customer-42',
      email: 'buyer@example.com',
      name: 'Bea Buyer',
      attributes: { plan: 'pro' },
    });

    const row = await t.ds.query<
      { external_id: string; email: string; name: string; attributes: Record<string, unknown> }[]
    >(`SELECT external_id, email, name, attributes FROM contacts WHERE id = $1`, [first.contactId]);
    expect(row[0]).toMatchObject({
      external_id: 'customer-42',
      email: 'buyer@example.com',
      name: 'Bea Buyer',
      attributes: { plan: 'pro' },
    });
  });

  it('rejects an external identity already claimed by another contact', async () => {
    const bot = await createBot();
    const first = await session(bot);
    const second = await session(bot);

    const firstResponse = await t.http
      .post('/api/widget/v1/contacts/identify')
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${first.token}`)
      .send({ externalId: 'customer-42' });
    expect(firstResponse.status).toBe(201);

    const secondResponse = await t.http
      .post('/api/widget/v1/contacts/identify')
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${second.token}`)
      .send({ externalId: 'customer-42' });

    expect(secondResponse.status).toBe(409);
    expect(codeOf(secondResponse.body)).toBe('conflict');
  });

  it('starts a new contact when a token for another bot is presented', async () => {
    const botA = await createBot();
    const botB = await createBot();
    const first = await session(botA);

    const res = await createSession(botB.publicKey, first.token);

    expect(res.status).toBe(201);
    expect((res.body as Session).contactId).not.toBe(first.contactId);
  });

  it('answers null for current before any conversation exists', async () => {
    const bot = await createBot();
    const { token } = await session(bot);

    const res = await withVisitor('/api/widget/v1/conversations/current', token);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('lists a created conversation as current, with its metadata in the row', async () => {
    const bot = await createBot();
    const { token, contactId } = await session(bot);

    const created = await t.http
      .post('/api/widget/v1/conversations')
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${token}`)
      .set('User-Agent', 'WidgetTest/1.0')
      .send({ metadata: { pageUrl: 'https://shop.com/cart', locale: 'en-US' } });

    expect(created.status).toBe(201);
    const conversation = created.body as Conversation;
    expect(conversation.status).toBe('ai');
    expect(conversation.messages).toEqual([]);

    const current = await withVisitor('/api/widget/v1/conversations/current', token);
    expect(current.status).toBe(200);
    expect((current.body as Conversation).id).toBe(conversation.id);

    const rows = await t.ds.query<{ metadata: Record<string, unknown>; contact_id: string }[]>(
      `SELECT metadata, contact_id FROM conversations WHERE id = $1`,
      [conversation.id],
    );
    expect(rows[0]?.contact_id).toBe(contactId);
    expect(rows[0]?.metadata).toMatchObject({
      pageUrl: 'https://shop.com/cart',
      locale: 'en-US',
      userAgent: 'WidgetTest/1.0',
    });

    const usage = await t.ds.query<{ conversations: number }[]>(
      `SELECT conversations FROM usage_daily WHERE workspace_id = $1 AND bot_id = $2`,
      [workspaceId, bot.id],
    );
    expect(usage[0]?.conversations).toBe(1);
  });

  it('rejects a conversation pageUrl longer than 2,000 characters', async () => {
    const bot = await createBot();
    const { token } = await session(bot);

    const res = await t.http
      .post('/api/widget/v1/conversations')
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${token}`)
      .send({ metadata: { pageUrl: `https://shop.com/${'a'.repeat(2000)}` } });

    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe('validation_failed');
  });

  it('never exposes internal bot fields in config', async () => {
    const bot = await createBot();
    const { token } = await session(bot);

    const res = await withVisitor('/api/widget/v1/config', token);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body as Record<string, unknown>).sort()).toEqual(
      [
        'avatarUrl',
        'csatEnabled',
        'displayName',
        'feedbackEnabled',
        'handoffEnabled',
        'position',
        'privacyUrl',
        'requireChallenge',
        'textColor',
        'themeColor',
        'welcomeMessage',
      ].sort(),
    );
    expect(res.body).toMatchObject({
      displayName: 'Support',
      themeColor: '#c7f36b',
      textColor: '#000000',
      handoffEnabled: true,
      feedbackEnabled: true,
      requireChallenge: false,
    });
  });

  it('rejects a config read without a visitor token', async () => {
    await createBot();

    const res = await t.http.get('/api/widget/v1/config').set('Origin', ALLOWED);

    expect(res.status).toBe(401);
    expect(codeOf(res.body)).toBe('unauthorized');
  });

  it('rejects current from a non-allowed origin', async () => {
    const bot = await createBot();
    const { token } = await session(bot);

    const res = await t.http
      .get('/api/widget/v1/conversations/current')
      .set('Origin', 'https://evil.test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(codeOf(res.body)).toBe('origin_not_allowed');
  });
});
