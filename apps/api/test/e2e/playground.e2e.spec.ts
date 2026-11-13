// SPDX-License-Identifier: AGPL-3.0-only
import { type ClientRequest, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderRegistry } from '../../src/providers';
import {
  createMockEmbeddingModel,
  createMockLanguageModel,
} from '../../src/providers/mock/mock-models';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { authed, createUser, createWorkspace, loginAs } from '../helpers/factories';

interface SseEvent {
  event: string;
  data: unknown;
}

/** Minimal SSE parser for the test: enough for events we expect on one connection. */
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

const QUESTION = 'What is the refund window?';

let t: TestApp;
let port: number;
let registry: ProviderRegistry;
let emailSeq = 0;
const open: ClientRequest[] = [];

function nextEmail(): string {
  emailSeq += 1;
  return `playground${String(emailSeq)}@example.com`;
}

interface Seeded {
  workspaceId: string;
  botId: string;
  cookies: string[];
}

async function seedRole(): Promise<Seeded> {
  const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
  const workspace = await createWorkspace(t, user, 'Acme');
  const cookies = await loginAs(t, user, password);

  const credentials = await t.ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', 'chat'), ($1, 'mock', 'embed') RETURNING id`,
    [workspace.id],
  );
  const [chat, embed] = credentials.map((row) => row.id);
  const bot = await t.ds.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim, retrieval_threshold)
     VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'mock-embed', 384, 0.3) RETURNING id`,
    [workspace.id, `pk_live_${Math.random().toString(36).slice(2, 10)}`, chat, embed],
  );
  const botId = bot[0]?.id ?? '';

  // The chunk text equals the question, so the deterministic mock embedding gives score 1.
  const embedder = createMockEmbeddingModel({ dimensions: 384, modelId: 'mock-embed' });
  const embedded = await embedder.doEmbed({ values: [QUESTION] });
  const vector = embedded.embeddings[0] ?? [];
  const source = await t.ds.query<{ id: string }[]>(
    `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, options, status)
     VALUES ($1, $2, 'text', 'Docs', '{}'::jsonb, 'ready') RETURNING id`,
    [workspace.id, botId],
  );
  const document = await t.ds.query<{ id: string }[]>(
    `INSERT INTO documents (workspace_id, bot_id, source_id, title)
     VALUES ($1, $2, $3, 'Refunds') RETURNING id`,
    [workspace.id, botId, source[0]?.id],
  );
  const version = await t.ds.query<{ id: string }[]>(
    `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
     VALUES ($1, $2, 'hash', '# Refunds') RETURNING id`,
    [workspace.id, document[0]?.id],
  );
  await t.ds.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
    document[0]?.id,
    version[0]?.id,
  ]);
  await t.ds.query(
    `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                         content, token_count, embedding, embedding_model, embedding_dim)
     VALUES ($1, $2, $3, 0, '# Refunds', $4, 3, $5::vector, 'mock-embed', 384)`,
    [workspace.id, botId, version[0]?.id, QUESTION, `[${vector.join(',')}]`],
  );

  return { workspaceId: workspace.id, botId, cookies };
}

function postSse(
  seeded: Seeded,
  body: unknown,
): { chunks: string[]; done: Promise<void>; request: ClientRequest } {
  const chunks: string[] = [];
  const payload = JSON.stringify(body);
  const request = httpRequest({
    host: '127.0.0.1',
    port,
    path: `/api/v1/workspaces/${seeded.workspaceId}/bots/${seeded.botId}/playground`,
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Cookie: seeded.cookies.map((value) => value.split(';')[0]).join('; '),
      Origin: t.config.publicUrl.origin,
      'X-Requested-With': 'fetch',
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
  return { chunks, done, request };
}

async function waitFor(chunks: string[], text: string): Promise<void> {
  await vi.waitFor(
    () => {
      expect(chunks.join('')).toContain(text);
    },
    { timeout: 5_000 },
  );
}

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
});

afterEach(() => {
  for (const request of open.splice(0)) request.destroy();
});

describe('POST /v1/workspaces/:workspaceId/bots/:botId/playground', () => {
  it('streams the spec §18.2 events and ends with the trace', async () => {
    const seeded = await seedRole();
    const { chunks, done } = postSse(seeded, { content: QUESTION });
    await done;

    const events = parseSse(chunks.join(''));
    const names = events.map((event) => event.event);
    expect(names[0]).toBe('answer.started');
    expect(names.filter((name) => name === 'answer.delta').length).toBeGreaterThan(0);
    expect(names.at(-2)).toBe('answer.completed');
    expect(names.at(-1)).toBe('trace');
    const completed = events.find((event) => event.event === 'answer.completed')?.data as
      { messageId: string; content: string; citations: { n: number; title: string }[] } | undefined;
    expect(completed?.messageId).toEqual(expect.any(String));
    expect(completed?.content).toContain('[1]');
    expect(completed?.citations).toEqual([expect.objectContaining({ n: 1, title: 'Refunds' })]);

    const trace = events.at(-1)?.data as { traceId: string; decision: string };
    expect(trace.decision).toBe('answered');
    const rows = await t.ds.query<Record<string, unknown>[]>(
      `SELECT origin, decision FROM generation_traces WHERE id = $1`,
      [trace.traceId],
    );
    expect(rows[0]).toMatchObject({ origin: 'playground', decision: 'answered' });
  });

  it('gives agents 403', async () => {
    const seeded = await seedRole();
    const { user: agent, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    await t.ds.query(
      `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agent')`,
      [seeded.workspaceId, agent.id],
    );
    const agentCookies = await loginAs(t, agent, password);

    const response = await authed(t, agentCookies)
      .post(`/api/v1/workspaces/${seeded.workspaceId}/bots/${seeded.botId}/playground`)
      .send({ content: QUESTION });
    expect(response.status).toBe(403);
  });

  it('validates the body', async () => {
    const seeded = await seedRole();
    const response = await authed(t, seeded.cookies)
      .post(`/api/v1/workspaces/${seeded.workspaceId}/bots/${seeded.botId}/playground`)
      .send({ content: 'x'.repeat(2_001) });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('aborts the model call when the client disconnects', async () => {
    registry.register('mock', () => ({
      languageModel: (modelId) =>
        createMockLanguageModel({
          modelId,
          chunkSize: 1,
          delayMs: 100,
          reply: () => 'x'.repeat(300),
        }),
      embeddingModel: (modelId) => createMockEmbeddingModel({ modelId, dimensions: 384 }),
    }));
    const seeded = await seedRole();
    const { chunks, request } = postSse(seeded, { content: QUESTION });

    await waitFor(chunks, 'event: answer.started');
    request.destroy();

    await vi.waitFor(
      async () => {
        const rows = await t.ds.query<Record<string, unknown>[]>(
          `SELECT decision, decision_reason FROM generation_traces
            WHERE workspace_id = $1`,
          [seeded.workspaceId],
        );
        expect(rows[0]).toMatchObject({ decision: 'error', decision_reason: 'aborted' });
      },
      { timeout: 1_500 },
    );
  });
});
