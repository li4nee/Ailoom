// SPDX-License-Identifier: AGPL-3.0-only
import { type ClientRequest, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../src/providers';
import {
  createMockEmbeddingModel,
  createMockLanguageModel,
} from '../../src/providers/mock/mock-models';
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

interface SseEvent {
  event: string;
  data: unknown;
}

function parseSse(raw: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of raw.split('\n\n')) {
    const lines = block.split('\n');
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
    const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
    if (event === undefined || data === undefined) continue;
    events.push({ event, data: JSON.parse(data) as unknown });
  }
  return events;
}

const ALLOWED = 'https://shop.com';
const QUESTION = 'What is the refund window?';

let emailSeq = 0;

describe('agent actions', () => {
  let t: TestApp;
  let port: number;
  let agentOne: AuthedClient;
  let agentTwo: AuthedClient;
  let workspaceId: string;
  let agentOneId: string;
  let agentTwoId: string;
  let botId: string;
  let publicKey: string;
  const open: ClientRequest[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen(0);
    port = (t.app.getHttpServer().address() as AddressInfo).port;
    t.app.get(ProviderRegistry).register('mock', () => ({
      languageModel: (modelId) => createMockLanguageModel({ modelId, chunkSize: 4, delayMs: 25 }),
      embeddingModel: (modelId) => createMockEmbeddingModel({ modelId, dimensions: 384 }),
    }));
  });

  afterAll(async () => {
    await t.close();
  });

  afterEach(() => {
    for (const request of open.splice(0)) request.destroy();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    emailSeq += 1;
    const ownerAccount = await createUser(
      { ds: t.ds },
      { email: `aa-owner${String(emailSeq)}@example.com`, name: 'Olivia Owner' },
    );
    const workspace = await createWorkspace(t, ownerAccount.user, 'Acme');
    workspaceId = workspace.id;

    const first = await createUser(
      { ds: t.ds },
      { email: `aa-one${String(emailSeq)}@example.com`, name: 'Alex Agent' },
    );
    agentOneId = first.user.id;
    await addMember(t, workspace, first.user, 'agent');
    agentOne = authed(t, await loginAs(t, first.user, first.password));

    const second = await createUser(
      { ds: t.ds },
      { email: `aa-two${String(emailSeq)}@example.com`, name: 'Blair Agent' },
    );
    agentTwoId = second.user.id;
    await addMember(t, workspace, second.user, 'agent');
    agentTwo = authed(t, await loginAs(t, second.user, second.password));

    const credentials = await t.ds.query<{ id: string }[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'mock', 'Chat'), ($1, 'mock', 'Embed') RETURNING id`,
      [workspaceId],
    );
    const [chat, embed] = credentials.map((row) => row.id);
    publicKey = `pk_live_agent_actions_${String(emailSeq)}`;
    const bot = await t.ds.query<{ id: string }[]>(
      `INSERT INTO bots (workspace_id, name, public_key, allowed_origins,
                         chat_credential_id, chat_model, embedding_credential_id,
                         embedding_model, embedding_dim, no_answer_behavior)
       VALUES ($1, 'Help', $2, $3, $4, 'mock-chat', $5, 'mock-embed', 384, 'offer_handoff')
       RETURNING id`,
      [workspaceId, publicKey, [ALLOWED], chat, embed],
    );
    botId = bot[0]?.id ?? '';
  });

  async function session(): Promise<{ token: string; contactId: string }> {
    const res = await t.http
      .post('/api/widget/v1/sessions')
      .set('Origin', ALLOWED)
      .send({ publicKey });
    if (res.status !== 201) throw new Error(`session create failed: ${String(res.status)}`);
    return res.body as { token: string; contactId: string };
  }

  async function createConversation(token: string): Promise<string> {
    const res = await t.http
      .post('/api/widget/v1/conversations')
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    if (res.status !== 201) {
      throw new Error(`conversation create failed: ${String(res.status)}`);
    }
    return (res.body as { id: string }).id;
  }

  async function seedKnowledge(): Promise<void> {
    const embedder = createMockEmbeddingModel({ dimensions: 384, modelId: 'mock-embed' });
    const embedded = await embedder.doEmbed({ values: [QUESTION] });
    const vector = embedded.embeddings[0] ?? [];
    const source = await t.ds.query<{ id: string }[]>(
      `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, options, status)
       VALUES ($1, $2, 'text', 'Docs', '{}'::jsonb, 'ready') RETURNING id`,
      [workspaceId, botId],
    );
    const document = await t.ds.query<{ id: string }[]>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, title)
       VALUES ($1, $2, $3, 'Refunds') RETURNING id`,
      [workspaceId, botId, source[0]?.id],
    );
    const version = await t.ds.query<{ id: string }[]>(
      `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
       VALUES ($1, $2, 'hash', '# Refunds') RETURNING id`,
      [workspaceId, document[0]?.id],
    );
    await t.ds.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
      document[0]?.id,
      version[0]?.id,
    ]);
    await t.ds.query(
      `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                           content, token_count, embedding, embedding_model, embedding_dim)
       VALUES ($1, $2, $3, 0, '# Refunds', $4, 3, $5::vector, 'mock-embed', 384)`,
      [workspaceId, botId, version[0]?.id, QUESTION, `[${vector.join(',')}]`],
    );
  }

  function url(conversationId: string, action: string): string {
    return `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/${action}`;
  }

  function openStream(
    path: string,
    headers: Record<string, string>,
  ): { chunks: string[]; done: Promise<void> } {
    const chunks: string[] = [];
    const request = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers });
    const done = new Promise<void>((resolve) => {
      request.on('response', (response) => {
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve();
        });
      });
      request.on('error', () => {
        resolve();
      });
    });
    request.end();
    open.push(request);
    return { chunks, done };
  }

  function postVisitorMessage(
    conversationId: string,
    token: string,
  ): { chunks: string[]; done: Promise<void> } {
    const payload = JSON.stringify({ content: QUESTION });
    const chunks: string[] = [];
    const request = httpRequest({
      host: '127.0.0.1',
      port,
      path: `/api/widget/v1/conversations/${conversationId}/messages`,
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
        Origin: ALLOWED,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    });
    const done = new Promise<void>((resolve) => {
      request.on('response', (response) => {
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve();
        });
      });
      request.on('error', () => {
        resolve();
      });
    });
    request.end(payload);
    open.push(request);
    return { chunks, done };
  }

  async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error('condition was not met in time');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it('an agent reply takes over and reaches the visitor live', async () => {
    const { token } = await session();
    const conversationId = await createConversation(token);
    const events = openStream(`/api/widget/v1/conversations/${conversationId}/events`, {
      Authorization: `Bearer ${token}`,
      Origin: ALLOWED,
      Accept: 'text/event-stream',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const res = await agentOne.post(url(conversationId, 'messages')).send({
      content: 'I can help with that.',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      role: 'agent',
      content: 'I can help with that.',
      author: { id: agentOneId, name: 'Alex Agent' },
    });
    await waitFor(() => parseSse(events.chunks.join('')).some((e) => e.event === 'message'));

    const received = parseSse(events.chunks.join('')).filter((e) => e.event === 'message');
    expect(received.at(-1)?.data).toMatchObject({
      role: 'agent',
      content: 'I can help with that.',
    });
    const row = await t.ds.query<{ status: string; assigned_user_id: string }[]>(
      `SELECT status, assigned_user_id FROM conversations WHERE id = $1`,
      [conversationId],
    );
    expect(row[0]).toMatchObject({ status: 'human', assigned_user_id: agentOneId });
    const system = await t.ds.query<{ content: string }[]>(
      `SELECT content FROM messages WHERE conversation_id = $1 AND role = 'system'`,
      [conversationId],
    );
    expect(system).toEqual([{ content: 'Alex Agent joined the conversation.' }]);
  });

  it('only one agent wins a simultaneous takeover', async () => {
    const { token } = await session();
    const conversationId = await createConversation(token);

    const [first, second] = await Promise.all([
      agentOne.post(url(conversationId, 'takeover')).send({}),
      agentTwo.post(url(conversationId, 'takeover')).send({}),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body).toMatchObject({ error: { code: 'already_assigned' } });
    expect(
      (loser.body as { error: { details: { path: string; message: string }[] } }).error.details,
    ).toEqual([{ path: 'assignedTo', message: expect.any(String) as string }]);
    const row = await t.ds.query<{ status: string; assigned_user_id: string }[]>(
      `SELECT status, assigned_user_id FROM conversations WHERE id = $1`,
      [conversationId],
    );
    expect(row[0]?.status).toBe('human');
    expect([agentOneId, agentTwoId]).toContain(row[0]?.assigned_user_id);
  });

  it('an agent reply aborts an in-flight AI answer', async () => {
    await seedKnowledge();
    const { token } = await session();
    const conversationId = await createConversation(token);

    const ai = postVisitorMessage(conversationId, token);
    await waitFor(() => parseSse(ai.chunks.join('')).some((e) => e.event === 'answer.started'));

    const res = await agentOne.post(url(conversationId, 'messages')).send({
      content: 'A person is taking over.',
    });
    expect(res.status).toBe(201);
    await ai.done;

    const rows = await t.ds.query<{ role: string; status: string; content: string }[]>(
      `SELECT role, status, content FROM messages WHERE conversation_id = $1 ORDER BY created_at`,
      [conversationId],
    );
    expect(rows.find((row) => row.role === 'ai')).toMatchObject({ status: 'error' });
    expect(rows.at(-1)).toMatchObject({ role: 'agent', content: 'A person is taking over.' });
    expect(parseSse(ai.chunks.join('')).map((event) => event.event)).not.toContain(
      'answer.completed',
    );
  });

  it('hand back returns control to the AI', async () => {
    await seedKnowledge();
    const { token } = await session();
    const conversationId = await createConversation(token);
    await agentOne.post(url(conversationId, 'takeover')).send({});

    const res = await agentOne.post(url(conversationId, 'handback')).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ai' });
    const row = await t.ds.query<{ status: string; assigned_user_id: string | null }[]>(
      `SELECT status, assigned_user_id FROM conversations WHERE id = $1`,
      [conversationId],
    );
    expect(row[0]).toEqual({ status: 'ai', assigned_user_id: null });

    const visitor = postVisitorMessage(conversationId, token);
    await visitor.done;
    expect(parseSse(visitor.chunks.join('')).map((event) => event.event)).toContain(
      'answer.completed',
    );
  });

  it('closing then an agent message reopens the conversation as human', async () => {
    const { token } = await session();
    const conversationId = await createConversation(token);
    await agentOne.post(url(conversationId, 'takeover')).send({});
    expect((await agentOne.post(url(conversationId, 'close')).send({})).body).toEqual({
      status: 'closed',
    });

    const res = await agentOne.post(url(conversationId, 'messages')).send({
      content: 'Reopening to help.',
    });

    expect(res.status).toBe(201);
    const row = await t.ds.query<{ status: string; closed_at: Date | null }[]>(
      `SELECT status, closed_at FROM conversations WHERE id = $1`,
      [conversationId],
    );
    expect(row[0]).toMatchObject({ status: 'human', closed_at: null });
  });

  it('the AI does not answer after a takeover', async () => {
    await seedKnowledge();
    const { token } = await session();
    const conversationId = await createConversation(token);
    await agentOne.post(url(conversationId, 'takeover')).send({});

    const visitor = postVisitorMessage(conversationId, token);
    await visitor.done;

    const names = parseSse(visitor.chunks.join('')).map((event) => event.event);
    expect(names).toEqual(['message.accepted']);
    const rows = await t.ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM messages
        WHERE conversation_id = $1 AND role = 'ai'`,
      [conversationId],
    );
    expect(rows[0]?.count).toBe(0);
  });
});
