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

describe('widget message stream', () => {
  let t: TestApp;
  let port: number;
  let registry: ProviderRegistry;
  let owner: AuthedClient;
  let workspaceId: string;
  let chatCredentialId: string;
  const open: ClientRequest[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen(0);
    port = (t.app.getHttpServer().address() as AddressInfo).port;
    registry = t.app.get(ProviderRegistry);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    registry.register('mock', () => ({
      languageModel: (modelId) => createMockLanguageModel({ modelId, chunkSize: 4 }),
      embeddingModel: (modelId) => createMockEmbeddingModel({ modelId, dimensions: 384 }),
    }));

    emailSeq += 1;
    const { user, password } = await createUser(
      { ds: t.ds },
      { email: `m${String(emailSeq)}@example.com` },
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
    if (credential.status !== 201) throw new Error('credential create failed');
    chatCredentialId = (credential.body as { id: string }).id;
  });

  afterEach(() => {
    for (const request of open.splice(0)) request.destroy();
  });

  async function createBot(): Promise<{ id: string; publicKey: string }> {
    const res = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
      name: 'Help',
      chatCredentialId,
      chatModel: 'mock-chat',
      embeddingCredentialId: chatCredentialId,
      embeddingModel: 'mock-embed',
      allowedOrigins: [ALLOWED],
    });
    if (res.status !== 201) throw new Error(`bot create failed with ${String(res.status)}`);
    return res.body as { id: string; publicKey: string };
  }

  async function session(bot: {
    publicKey: string;
  }): Promise<{ token: string; contactId: string }> {
    const res = await t.http
      .post('/api/widget/v1/sessions')
      .set('Origin', ALLOWED)
      .send({ publicKey: bot.publicKey });
    if (res.status !== 201) throw new Error(`session create failed with ${String(res.status)}`);
    return res.body as { token: string; contactId: string };
  }

  async function createConversation(token: string): Promise<string> {
    const res = await t.http
      .post('/api/widget/v1/conversations')
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    if (res.status !== 201)
      throw new Error(`conversation create failed with ${String(res.status)}`);
    return (res.body as { id: string }).id;
  }

  /** Seeds one chunk whose text is the question, so the mock embedding scores 1. */
  async function seedKnowledge(botId: string): Promise<void> {
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

  function postMessage(
    conversationId: string,
    token: string,
    body: unknown,
    origin = ALLOWED,
  ): { chunks: string[]; done: Promise<void> } {
    const chunks: string[] = [];
    const payload = JSON.stringify(body);
    const request = httpRequest({
      host: '127.0.0.1',
      port,
      path: `/api/widget/v1/conversations/${conversationId}/messages`,
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
        Origin: origin,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    });
    const done = new Promise<void>((resolve) => {
      request.on('response', (response) => {
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => chunks.push(chunk));
        response.on('end', resolve);
      });
      request.on('error', () => {
        resolve();
      });
    });
    request.end(payload);
    open.push(request);
    return { chunks, done };
  }

  it('streams the visitor message and a cited answer, without a trace event', async () => {
    const bot = await createBot();
    await seedKnowledge(bot.id);
    const { token } = await session(bot);
    const conversationId = await createConversation(token);

    const { chunks, done } = postMessage(conversationId, token, { content: QUESTION });
    await done;

    const events = parseSse(chunks.join(''));
    const names = events.map((event) => event.event);
    expect(names[0]).toBe('message.accepted');
    expect(names).toContain('answer.started');
    expect(names.filter((name) => name === 'answer.delta').length).toBeGreaterThan(0);
    expect(names.at(-1)).toBe('answer.completed');
    expect(names).not.toContain('trace');

    const completed = events.at(-1)?.data as {
      messageId: string;
      content: string;
      citations: { n: number; title: string }[];
    };
    expect(completed.messageId).toEqual(expect.any(String));
    expect(completed.content).toContain('[1]');
    expect(completed.citations).toEqual([expect.objectContaining({ n: 1, title: 'Refunds' })]);

    const rows = await t.ds.query<Record<string, unknown>[]>(
      `SELECT origin, role, status FROM generation_traces t
         JOIN messages m ON m.id = t.message_id
        WHERE t.workspace_id = $1`,
      [workspaceId],
    );
    expect(rows[0]).toMatchObject({ origin: 'widget', role: 'ai', status: 'complete' });
  });

  it('escalates when no knowledge is relevant', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await createConversation(token);

    const { chunks, done } = postMessage(conversationId, token, { content: QUESTION });
    await done;

    const events = parseSse(chunks.join(''));
    const escalated = events.find((event) => event.event === 'escalated');
    expect(escalated?.data).toMatchObject({
      behavior: 'offer_handoff',
      reason: 'no_knowledge',
    });
  });

  it('offers a handoff when the visitor asks for a person', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await createConversation(token);

    const { chunks, done } = postMessage(conversationId, token, {
      content: 'I want to talk to a human',
    });
    await done;

    const events = parseSse(chunks.join(''));
    expect(events.find((event) => event.event === 'handoff.offered')?.data).toMatchObject({
      reason: 'handoff_intent',
    });
  });

  it('404s for the conversation of another contact', async () => {
    const bot = await createBot();
    const first = await session(bot);
    const second = await session(bot);
    const secondConversation = await createConversation(second.token);

    const res = await t.http
      .post(`/api/widget/v1/conversations/${secondConversation}/messages`)
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${first.token}`)
      .send({ content: QUESTION });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
  });

  it('rejects a message over 2,000 characters before opening the stream', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await createConversation(token);

    const res = await t.http
      .post(`/api/widget/v1/conversations/${conversationId}/messages`)
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'x'.repeat(2001) });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'message_too_long' } });
  });

  it('answers a second concurrent message with one SSE error event', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await createConversation(token);
    // A turn is already in flight: a young streaming placeholder blocks beginTurn.
    await t.ds.query(
      `INSERT INTO messages (workspace_id, conversation_id, role, content, status)
       VALUES ($1, $2, 'ai', '', 'streaming')`,
      [workspaceId, conversationId],
    );

    const { chunks, done } = postMessage(conversationId, token, { content: QUESTION });
    await done;

    const events = parseSse(chunks.join(''));
    expect(events.map((event) => event.event)).toEqual(['error']);
    expect(events[0]?.data).toMatchObject({ code: 'answer_in_progress' });
  });

  it('rate-limits the 21st message in a minute', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    // Rate limiting happens in the guard, before the route reads the conversation id.
    const conversationId = '00000000-0000-4000-8000-000000000000';
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      const res = await t.http
        .post(`/api/widget/v1/conversations/${conversationId}/messages`)
        .set('Origin', ALLOWED)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'hi' });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
