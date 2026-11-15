// SPDX-License-Identifier: AGPL-3.0-only
import type { Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import {
  authed,
  type AuthedClient,
  createUser,
  createWorkspace,
  loginAs,
} from '../helpers/factories';
import { listRoutes, type Route } from './route-inventory';

interface WidgetClient {
  owner: AuthedClient;
  workspaceId: string;
  botId: string;
  publicKey: string;
  origin: string;
}

interface Session {
  token: string;
  contactId: string;
}

interface Conversation {
  id: string;
}

/** Routes that start a visitor or read the public config: they take no resource id. */
const EXEMPT = new Set([
  'POST /api/widget/v1/sessions',
  'GET /api/widget/v1/config',
  'GET /api/widget/v1/challenge',
]);

const BODIES: Record<string, unknown> = {
  'POST /api/widget/v1/conversations/:conversationId/messages': { content: 'Hello?' },
  'POST /api/widget/v1/conversations/:conversationId/handoff': {},
  'POST /api/widget/v1/messages/:messageId/feedback': { rating: -1 },
};

function paramNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z_]\w*)/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
}

function call(t: TestApp, route: Route, ids: Record<string, string>, token: string): Test {
  const path = route.path.replace(/:([A-Za-z_]\w*)/g, (_, name: string) => {
    const value = ids[name];
    if (value === undefined) throw new Error(`no value for :${name} in ${route.path}`);
    return value;
  });
  const request = t.http
    .get(path)
    .set('Origin', 'https://a.test')
    .set('Authorization', `Bearer ${token}`);
  const body = BODIES[`${route.method} ${route.path}`];
  if (body !== undefined && route.method === 'POST') request.send(body as object);
  return request;
}

let t: TestApp;
let a: WidgetClient;
let b: WidgetClient;
let contactX: Session;
let contactY: Session;
let conversationY: Conversation;
let messageYId: string;
let conversationB: Conversation;
let allConversationRoutes: Route[];

async function buildClient(email: string, name: string, origin: string): Promise<WidgetClient> {
  const { user, password } = await createUser({ ds: t.ds }, { email });
  const workspaceId = (await createWorkspace(t, user, name)).id;
  const owner = authed(t, await loginAs(t, user, password));

  // The factory inserts the workspace directly, so `workspace.created` never fired.
  await t.ds.query(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'local', 'Built-in (local)')`,
    [workspaceId],
  );
  const chat = await owner
    .post(`/api/v1/workspaces/${workspaceId}/credentials`)
    .send({ provider: 'mock', label: 'Chat' });
  const embedding = await owner
    .post(`/api/v1/workspaces/${workspaceId}/credentials`)
    .send({ provider: 'mock', label: 'Embedding' });
  if (chat.status !== 201 || embedding.status !== 201) {
    throw new Error('credential create failed');
  }

  const bot = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
    name: 'Help',
    chatCredentialId: (chat.body as { id: string }).id,
    chatModel: 'mock-chat',
    embeddingCredentialId: (embedding.body as { id: string }).id,
    embeddingModel: 'mock-embed',
    allowedOrigins: [origin],
  });
  if (bot.status !== 201) throw new Error(`bot create failed with ${String(bot.status)}`);
  const body = bot.body as { id: string; publicKey: string };
  return { owner, workspaceId, botId: body.id, publicKey: body.publicKey, origin };
}

async function session(client: WidgetClient, token?: string): Promise<Session> {
  const res = await t.http
    .post('/api/widget/v1/sessions')
    .set('Origin', client.origin)
    .send({ publicKey: client.publicKey, ...(token === undefined ? {} : { token }) });
  if (res.status !== 201) throw new Error(`session failed with ${String(res.status)}`);
  return res.body as Session;
}

async function conversation(client: WidgetClient, token: string): Promise<Conversation> {
  const res = await t.http
    .post('/api/widget/v1/conversations')
    .set('Origin', client.origin)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (res.status !== 201) throw new Error(`conversation failed with ${String(res.status)}`);
  return res.body as Conversation;
}

beforeAll(async () => {
  t = await createTestApp();
  await resetDatabase(t.ds);

  a = await buildClient('owner-a@example.com', 'A', 'https://a.test');
  b = await buildClient('owner-b@example.com', 'B', 'https://b.test');

  contactX = await session(a);
  contactY = await session(a);
  conversationY = await conversation(a, contactY.token);
  conversationB = await conversation(b, (await session(b)).token);
  if (contactX.contactId === contactY.contactId) throw new Error('sessions shared a contact');

  const rows = await t.ds.query<{ id: string }[]>(
    `INSERT INTO messages (workspace_id, conversation_id, role, content, status)
     VALUES ($1, $2, 'ai', 'An answer for contact Y', 'complete') RETURNING id`,
    [a.workspaceId, conversationY.id],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('message insert returned no id');
  messageYId = id;

  allConversationRoutes = listRoutes(t.app)
    .filter((route) => route.path.startsWith('/api/widget/v1'))
    .filter((route) => paramNames(route.path).length > 0)
    .filter((route) => !EXEMPT.has(`${route.method} ${route.path}`));
});

afterAll(async () => {
  await t.close();
});

describe('widget isolation', () => {
  it('covers every widget route that takes a resource id', () => {
    expect(allConversationRoutes.length).toBeGreaterThan(0);
    const uncovered = allConversationRoutes.flatMap((route) =>
      paramNames(route.path)
        .filter((param) => param !== 'conversationId' && param !== 'messageId')
        .map((param) => `${route.method} ${route.path} (:${param})`),
    );
    expect(uncovered).toEqual([]);
  });

  it("answers 404 to a token from bot A for bot B's conversation on every route", async () => {
    const leaks: string[] = [];
    for (const route of allConversationRoutes) {
      const res = await call(
        t,
        route,
        { conversationId: conversationB.id, messageId: messageYId },
        contactX.token,
      );
      if (res.status !== 404) leaks.push(`${route.method} ${route.path} → ${String(res.status)}`);
    }
    expect(leaks).toEqual([]);
  });

  it("answers 404 to contact X for contact Y's conversation of the same bot", async () => {
    const leaks: string[] = [];
    for (const route of allConversationRoutes) {
      const res = await call(
        t,
        route,
        { conversationId: conversationY.id, messageId: messageYId },
        contactX.token,
      );
      if (res.status !== 404) leaks.push(`${route.method} ${route.path} → ${String(res.status)}`);
    }
    expect(leaks).toEqual([]);
  });

  it("answers 404 for feedback on another contact's message", async () => {
    const res = await t.http
      .post(`/api/widget/v1/messages/${messageYId}/feedback`)
      .set('Origin', a.origin)
      .set('Authorization', `Bearer ${contactX.token}`)
      .send({ rating: -1 });

    expect(res.status).toBe(404);
    const rows = await t.ds.query<{ feedback: number | null }[]>(
      'SELECT feedback FROM messages WHERE id = $1',
      [messageYId],
    );
    expect(rows[0]?.feedback).toBeNull();
  });

  it('leaves the owner able to use their own conversation', async () => {
    const res = await t.http
      .post(`/api/widget/v1/conversations/${conversationY.id}/handoff`)
      .set('Origin', a.origin)
      .set('Authorization', `Bearer ${contactY.token}`)
      .send({});

    expect(res.status).toBe(200);
  });

  it('answers 403 from an origin its bot does not allow', async () => {
    const res = await t.http
      .get('/api/widget/v1/conversations/current')
      .set('Origin', 'https://evil.test')
      .set('Authorization', `Bearer ${contactX.token}`);

    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('origin_not_allowed');
  });
});
