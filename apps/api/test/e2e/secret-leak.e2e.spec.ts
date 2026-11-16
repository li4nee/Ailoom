// SPDX-License-Identifier: AGPL-3.0-only
import { type ClientRequest, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { WorkerAppModule } from '../../src/app/worker-app.module';
import { ProviderRegistry } from '../../src/providers';
import {
  createMockEmbeddingModel,
  createMockLanguageModel,
} from '../../src/providers/mock/mock-models';
import { createTestApp, type TestApp } from '../helpers/app';
import { captureEverything, captureSeams } from '../helpers/capture';
import { resetDatabase } from '../helpers/db';
import {
  authed,
  type AuthedClient,
  createUser,
  createWorkspace,
  loginAs,
} from '../helpers/factories';

const ORIGIN = 'https://shop.example.com';
const QUESTION = 'What is the refund window?';
const AUTH_MARKER = 'AUTH_SECRET_LEAK_MARKER_7f3c9a';
const WIDGET_MARKER = 'WIDGET_SECRET_LEAK_MARKER_2b8d1e';
const ENCRYPTION_MARKER = 'ENCRYPTION_KEY_LEAK_MARKER_5a4f2c';
const PASSWORD_MARKER = 'password-leak-marker-9c1e';
const PROVIDER_KEY_MARKER = 'sk-leaktest-4e7a9c2d';
const PROVIDER_BODY_MARKER = `Incorrect API key provided: ${PROVIDER_KEY_MARKER}`;

interface Seeded {
  workspaceId: string;
  botId: string;
  publicKey: string;
  chatCredentialId: string;
  embedCredentialId: string;
}

let t: TestApp;
let worker: INestApplicationContext;
let port: number;
let registry: ProviderRegistry;
let owner: AuthedClient;
let seeded: Seeded;
const seams = captureSeams();
let captured: ReturnType<typeof captureEverything>;
const open: ClientRequest[] = [];

function record(response: { text: string }): void {
  captured.responses.push(response.text);
}

/** A raw provider failure whose message contains what a 401 body would have said. */
function providerFailure(): Error {
  return Object.assign(new Error(PROVIDER_BODY_MARKER), { statusCode: 401 });
}

function workingMock(modelId: string) {
  return {
    languageModel: () => createMockLanguageModel({ modelId, chunkSize: 4 }),
    embeddingModel: () => createMockEmbeddingModel({ modelId, dimensions: 384 }),
  };
}

/** Raw SSE request, so the full stream is captured as response text. */
function streamWidget(path: string, body: unknown, headers: Record<string, string> = {}) {
  const chunks: string[] = [];
  const payload = JSON.stringify(body);
  const request = httpRequest({
    host: '127.0.0.1',
    port,
    path,
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Origin: ORIGIN,
      'X-Requested-With': 'fetch',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      ...headers,
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

async function seedWorkspace(): Promise<void> {
  const { user, password } = await createUser(
    { ds: t.ds },
    { email: 'owner@example.com', password: PASSWORD_MARKER, isInstanceAdmin: true },
  );
  const workspace = await createWorkspace(t, user, 'Leak Test');
  owner = authed(t, await loginAs(t, user, password));

  await t.ds.query(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'local', 'Built-in (local)')`,
    [workspace.id],
  );
  const markerCredential = await owner
    .post(`/api/v1/workspaces/${workspace.id}/credentials`)
    .send({ provider: 'openai', label: 'Leak marker key', apiKey: PROVIDER_KEY_MARKER });
  expect(markerCredential.status).toBe(201);
  record(markerCredential);

  const chatCredential = await owner
    .post(`/api/v1/workspaces/${workspace.id}/credentials`)
    .send({ provider: 'mock', label: 'Chat' });
  expect(chatCredential.status).toBe(201);
  record(chatCredential);
  const chatCredentialId = (chatCredential.body as { id: string }).id;

  const embedCredential = await owner
    .post(`/api/v1/workspaces/${workspace.id}/credentials`)
    .send({ provider: 'mock', label: 'Embed' });
  expect(embedCredential.status).toBe(201);
  record(embedCredential);
  const embedCredentialId = (embedCredential.body as { id: string }).id;

  const tested = await owner.post(
    `/api/v1/workspaces/${workspace.id}/credentials/${chatCredentialId}/test`,
  );
  record(tested);
  expect(tested.status).toBe(200);

  const listed = await owner.get(`/api/v1/workspaces/${workspace.id}/credentials`);
  record(listed);
  expect(listed.status).toBe(200);

  const bot = await owner.post(`/api/v1/workspaces/${workspace.id}/bots`).send({
    name: 'Help',
    chatCredentialId,
    chatModel: 'mock-chat',
    embeddingCredentialId: embedCredentialId,
    embeddingModel: 'mock-embed',
    retrievalThreshold: 0,
    allowedOrigins: [ORIGIN],
  });
  record(bot);
  expect(bot.status).toBe(201);
  const body = bot.body as { id: string; publicKey: string };

  const embedder = createMockEmbeddingModel({ dimensions: 384, modelId: 'mock-embed' });
  const embedded = await embedder.doEmbed({ values: [QUESTION] });
  const vector = embedded.embeddings[0] ?? [];
  const source = await t.ds.query<{ id: string }[]>(
    `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, options, status)
     VALUES ($1, $2, 'text', 'Docs', '{}'::jsonb, 'ready') RETURNING id`,
    [workspace.id, body.id],
  );
  const document = await t.ds.query<{ id: string }[]>(
    `INSERT INTO documents (workspace_id, bot_id, source_id, title)
     VALUES ($1, $2, $3, 'Refunds') RETURNING id`,
    [workspace.id, body.id, source[0]?.id],
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
    [workspace.id, body.id, version[0]?.id, QUESTION, `[${vector.join(',')}]`],
  );

  seeded = {
    workspaceId: workspace.id,
    botId: body.id,
    publicKey: body.publicKey,
    chatCredentialId,
    embedCredentialId,
  };
}

beforeAll(async () => {
  t = await createTestApp({
    config: {
      signupMode: 'open',
      email: {
        transport: 'smtp',
        host: 'smtp.example.com',
        port: 587,
        user: null,
        pass: null,
        secure: false,
        from: 'support@example.com',
      },
      auth: {
        secrets: [Buffer.from(`${AUTH_MARKER}${'a'.repeat(7)}`)],
        accessTokenTtlMin: 15,
        refreshTokenTtlDays: 30,
      },
      widgetSecret: Buffer.from(`${WIDGET_MARKER}${'w'.repeat(7)}`),
      encryptionKeys: [
        { version: 1, key: Buffer.from(ENCRYPTION_MARKER.padEnd(32, 'k').slice(0, 32)) },
      ],
    },
    mailer: seams.mailer,
    loggerDestination: seams.loggerDestination,
  });
  await t.app.listen(0);
  port = (t.app.getHttpServer().address() as AddressInfo).port;
  registry = t.app.get(ProviderRegistry);
  captured = captureEverything(t, seams);
  worker = await NestFactory.createApplicationContext(
    WorkerAppModule.register(t.config, { dataSource: t.ds, mailer: seams.mailer }),
  );
  await worker.init();
});

afterAll(async () => {
  await worker.close();
  await t.close();
});

afterEach(() => {
  for (const request of open.splice(0)) request.destroy();
});

describe('secret leak detection', () => {
  it('never exposes secrets in responses, logs, emails or database rows', async () => {
    await resetDatabase(t.ds);
    registry.register('mock', () => workingMock('mock-chat'));
    await seedWorkspace();

    // Login and refresh: the response body never echoes the password or refresh token.
    const login = await t.http
      .post('/api/v1/auth/login')
      .set({ 'X-Requested-With': 'fetch', Origin: t.config.publicUrl.origin })
      .send({ email: 'owner@example.com', password: PASSWORD_MARKER });
    record(login);
    expect(login.status).toBe(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const refreshCookie = cookies.find((value) => value.startsWith('__Secure-rt='));
    expect(refreshCookie).toBeDefined();
    const refresh = await t.http
      .post('/api/v1/auth/refresh')
      .set({ 'X-Requested-With': 'fetch', Origin: t.config.publicUrl.origin })
      .set('Cookie', refreshCookie?.split(';')[0] ?? '');
    record(refresh);
    expect(refresh.status).toBe(200);

    // Forgot password: the worker renders and records the email.
    const forgot = await t.http
      .post('/api/v1/auth/forgot-password')
      .set({ 'X-Requested-With': 'fetch', Origin: t.config.publicUrl.origin })
      .send({ email: 'owner@example.com' });
    record(forgot);
    expect(forgot.status).toBe(200);
    await vi.waitFor(
      () => {
        expect(seams.mailer.sent.some((message) => message.subject.includes('password'))).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );

    // A provider 401 body carries the marker; the widget stream must only show a safe message.
    registry.register('mock', () => ({
      languageModel: (modelId) => createMockLanguageModel({ modelId, failWith: providerFailure() }),
      embeddingModel: (modelId) => createMockEmbeddingModel({ modelId, dimensions: 384 }),
    }));
    const session = await t.http
      .post('/api/widget/v1/sessions')
      .set('Origin', ORIGIN)
      .send({ publicKey: seeded.publicKey });
    record(session);
    expect(session.status).toBe(201);
    const token = (session.body as { token: string }).token;
    const conversation = await t.http
      .post('/api/widget/v1/conversations')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    record(conversation);
    const conversationId = (conversation.body as { id: string }).id;

    const failed = streamWidget(
      `/api/widget/v1/conversations/${conversationId}/messages`,
      { content: QUESTION },
      { Authorization: `Bearer ${token}` },
    );
    await failed.done;
    const failedText = failed.chunks.join('');
    captured.responses.push(failedText);
    expect(failedText).toContain('event: escalated');
    expect(failedText).toContain('provider_error');
    expect(failedText).not.toContain(PROVIDER_KEY_MARKER);
    expect(failedText).not.toContain(PROVIDER_BODY_MARKER);

    // A working model answers; replaying the trace and reading the audit log must stay clean.
    // A fresh conversation avoids the escalated state the failed turn left behind.
    registry.register('mock', () => workingMock('mock-chat'));
    const secondConversation = await t.http
      .post('/api/widget/v1/conversations')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    record(secondConversation);
    const secondConversationId = (secondConversation.body as { id: string }).id;
    const answered = streamWidget(
      `/api/widget/v1/conversations/${secondConversationId}/messages`,
      { content: QUESTION },
      { Authorization: `Bearer ${token}` },
    );
    await answered.done;
    const answeredText = answered.chunks.join('');
    captured.responses.push(answeredText);
    expect(answeredText).toContain('event: answer.completed');
    const completed = /event: answer\.completed\ndata: (.+)\n/.exec(answeredText);
    expect(completed).not.toBeNull();
    const messageId = (JSON.parse(completed?.[1] ?? '{}') as { messageId: string }).messageId;
    const trace = await owner.get(
      `/api/v1/workspaces/${seeded.workspaceId}/messages/${messageId}/trace`,
    );
    record(trace);
    expect(trace.status).toBe(200);

    const audit = await owner.get(`/api/v1/workspaces/${seeded.workspaceId}/audit-log`);
    record(audit);
    expect(audit.status).toBe(200);

    const diagnostics = await owner.get('/api/health/diagnostics');
    record(diagnostics);
    expect(diagnostics.status).toBe(200);

    // The playground exercises the same provider path with the owner's credentials.
    const playground = streamWidget(
      `/api/v1/workspaces/${seeded.workspaceId}/bots/${seeded.botId}/playground`,
      { content: QUESTION },
      { Cookie: cookies.map((value) => value.split(';')[0]).join('; ') },
    );
    await playground.done;
    captured.responses.push(playground.chunks.join(''));

    const dump = await captured.dbDump();
    const haystacks = {
      responses: captured.responses.join('\n'),
      logs: captured.logs.join('\n'),
      emails: captured.emails.join('\n'),
      database: dump,
    };
    for (const marker of [
      AUTH_MARKER,
      WIDGET_MARKER,
      ENCRYPTION_MARKER,
      PASSWORD_MARKER,
      PROVIDER_KEY_MARKER,
      PROVIDER_BODY_MARKER,
    ]) {
      for (const [where, haystack] of Object.entries(haystacks)) {
        expect(haystack, `${marker} leaked into ${where}`).not.toContain(marker);
      }
    }
    // The refresh token is only ever a cookie/hash, never a stored plaintext value.
    const refreshToken = refreshCookie?.split(';')[0]?.split('=')[1] ?? '';
    expect(refreshToken).not.toBe('');
    expect(dump).not.toContain(refreshToken);
  });
});
