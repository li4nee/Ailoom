// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BotsService } from '../../src/modules/bots/bots.service';
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

interface BotBody {
  id: string;
  name: string;
  publicKey: string;
  allowedOrigins: string[];
  chatCredentialId: string;
  chatModel: string;
  embeddingCredentialId: string;
  embeddingModel: string;
  embeddingDim: number;
  retrievalThreshold: number;
  noAnswerBehavior: string;
  handoffEnabled: boolean;
  temperature: number;
  maxOutputTokens: number;
  fallbackMessage: string;
  handoffMessage: string;
  appearance: { displayName: string; themeColor: string; position: string };
}

let emailSeq = 0;

function nextEmail(): string {
  emailSeq += 1;
  return `bots${String(emailSeq)}@example.com`;
}

describe('bots', () => {
  let t: TestApp;
  let bots: BotsService;
  let owner: AuthedClient;
  let workspaceId: string;
  let chatCredentialId: string;
  let embedCredentialId: string;

  beforeAll(async () => {
    t = await createTestApp();
    bots = t.app.get(BotsService);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    workspaceId = (await createWorkspace(t, user, 'Acme')).id;
    owner = authed(t, await loginAs(t, user, password));

    // The factory inserts the workspace directly, so `workspace.created` never fired: create
    // the built-in row the listener would have provisioned.
    await t.ds.query(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'local', 'Built-in (local)')`,
      [workspaceId],
    );
    chatCredentialId = await createCredential('Chat');
    embedCredentialId = await createCredential('Embed');
  });

  async function createCredential(label: string): Promise<string> {
    const res = await owner
      .post(`/api/v1/workspaces/${workspaceId}/credentials`)
      .send({ provider: 'mock', label });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  }

  function url(path = ''): string {
    return `/api/v1/workspaces/${workspaceId}/bots${path}`;
  }

  async function createBot(body: Record<string, unknown> = {}): Promise<BotBody> {
    const res = await owner.post(url()).send({
      name: 'Help',
      chatCredentialId,
      chatModel: 'mock-chat',
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body as BotBody;
  }

  function codeOf(body: unknown): string {
    return (body as ErrorBody).error.code;
  }

  it('creates a bot with defaults, a pk_live key and local embeddings', async () => {
    const bot = await createBot();

    expect(bot).toMatchObject({
      name: 'Help',
      chatModel: 'mock-chat',
      allowedOrigins: [],
      embeddingModel: 'bge-small-en-v1.5',
      embeddingDim: 384,
      retrievalThreshold: 0.35,
      noAnswerBehavior: 'offer_handoff',
      handoffEnabled: true,
      temperature: 0.2,
      maxOutputTokens: 600,
      appearance: { displayName: 'Support', themeColor: '#2563eb', position: 'right' },
    });
    expect(bot.publicKey).toMatch(/^pk_live_[0-9A-Za-z]{24}$/);

    const list = await owner.get(url());
    expect(list.status).toBe(200);
    expect((list.body as BotBody[]).map((b) => b.id)).toEqual([bot.id]);
  });

  it('rejects an embedding credential that cannot embed', async () => {
    const anthropic = await owner
      .post(`/api/v1/workspaces/${workspaceId}/credentials`)
      .send({ provider: 'anthropic', label: 'Claude', apiKey: 'sk-ant-1' });
    expect(anthropic.status).toBe(201);

    const res = await owner.post(url()).send({
      name: 'Help',
      chatCredentialId,
      chatModel: 'mock-chat',
      embeddingCredentialId: (anthropic.body as { id: string }).id,
      embeddingModel: 'text-embedding-3-small',
    });

    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe('embeddings_not_supported');
  });

  it('rejects a credential from another workspace', async () => {
    const { user: otherOwner } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const other = await createWorkspace(t, otherOwner, 'Globex');
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'mock', 'Elsewhere') RETURNING id`,
      [other.id],
    );

    const res = await owner.post(url()).send({
      name: 'Help',
      chatCredentialId: rows[0]?.id,
      chatModel: 'mock-chat',
    });

    expect(res.status).toBe(404);
    expect(codeOf(res.body)).toBe('not_found');
  });

  it('normalizes origins on update', async () => {
    const bot = await createBot();

    const res = await owner
      .patch(url(`/${bot.id}`))
      .send({ allowedOrigins: ['HTTPS://Shop.com/', 'https://*.shop.com'] });

    expect(res.status).toBe(200);
    expect((res.body as BotBody).allowedOrigins).toEqual([
      'https://shop.com',
      'https://*.shop.com',
    ]);
  });

  it('rejects switching chat credentials without the model that goes with it', async () => {
    const bot = await createBot();
    const other = await createCredential('Second chat');

    const res = await owner.patch(url(`/${bot.id}`)).send({ chatCredentialId: other });
    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe('validation_failed');

    const withModel = await owner
      .patch(url(`/${bot.id}`))
      .send({ chatCredentialId: other, chatModel: 'mock-chat' });
    expect(withModel.status).toBe(200);
    expect((withModel.body as BotBody).chatCredentialId).toBe(other);
  });

  it('rejects an origin with a path', async () => {
    const bot = await createBot();

    const res = await owner.patch(url(`/${bot.id}`)).send({
      allowedOrigins: ['https://shop.com/app'],
    });

    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe('validation_failed');
  });

  it('rotating the key invalidates the old one', async () => {
    const bot = await createBot();

    const res = await owner.post(url(`/${bot.id}/rotate-key`));
    expect(res.status).toBe(200);
    const rotated = res.body as BotBody;
    expect(rotated.publicKey).not.toBe(bot.publicKey);
    expect(rotated.publicKey).toMatch(/^pk_live_/);

    await expect(bots.getForWidget(bot.publicKey)).resolves.toBeNull();
    await expect(bots.getForWidget(rotated.publicKey)).resolves.not.toBeNull();
  });

  it('agents can read but not change bots', async () => {
    const bot = await createBot();
    const { user: agent, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    await t.ds.query(
      "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agent')",
      [workspaceId, agent.id],
    );
    const agentClient = authed(t, await loginAs(t, agent, password));

    expect((await agentClient.get(url())).status).toBe(200);
    expect((await agentClient.get(url(`/${bot.id}`))).status).toBe(200);
    expect(
      (
        await agentClient.post(url()).send({
          name: 'Agent bot',
          chatCredentialId,
          chatModel: 'mock-chat',
        })
      ).status,
    ).toBe(403);
    expect((await agentClient.patch(url(`/${bot.id}`)).send({ name: 'X' })).status).toBe(403);
    expect((await agentClient.delete(url(`/${bot.id}`))).status).toBe(403);
    expect((await agentClient.post(url(`/${bot.id}/rotate-key`))).status).toBe(403);
  });

  it('soft-deleted bots disappear from lists and widget lookup', async () => {
    const bot = await createBot();

    expect((await owner.delete(url(`/${bot.id}`))).status).toBe(204);
    expect(await owner.get(url(`/${bot.id}`))).toMatchObject({ status: 404 });
    const list = await owner.get(url());
    expect(list.body as BotBody[]).toEqual([]);
    await expect(bots.getForWidget(bot.publicKey)).resolves.toBeNull();
  });

  it('changing the embedding model with no knowledge updates dimensions', async () => {
    const bot = await createBot();
    expect(bot.embeddingDim).toBe(384);

    const res = await owner.patch(url(`/${bot.id}`)).send({
      embeddingCredentialId: embedCredentialId,
      embeddingModel: 'mock-embed',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ embeddingModel: 'mock-embed', embeddingDim: 8 });
  });

  it('refuses an embedding change while the bot has chunks', async () => {
    const bot = await createBot();
    const source = await t.ds.query<{ id: string }[]>(
      `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title)
       VALUES ($1, $2, 'url', 'Docs') RETURNING id`,
      [workspaceId, bot.id],
    );
    const document = await t.ds.query<{ id: string }[]>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, title)
       VALUES ($1, $2, $3, 'Doc') RETURNING id`,
      [workspaceId, bot.id, source[0]?.id],
    );
    const version = await t.ds.query<{ id: string }[]>(
      `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
       VALUES ($1, $2, 'hash', 'content') RETURNING id`,
      [workspaceId, document[0]?.id],
    );
    await t.ds.query(
      `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, content,
                           token_count, embedding, embedding_model, embedding_dim)
       VALUES ($1, $2, $3, 0, 'content', 1, array_fill(0.0, ARRAY[384])::vector,
               'bge-small-en-v1.5', 384)`,
      [workspaceId, bot.id, version[0]?.id],
    );

    const res = await owner
      .patch(url(`/${bot.id}`))
      .send({ embeddingCredentialId: embedCredentialId, embeddingModel: 'mock-embed' });

    expect(res.status).toBe(409);
    expect(codeOf(res.body)).toBe('reembed_not_available');

    // A form resends the stored pair with its other changes; that is not an embedding change.
    const unchanged = await owner.patch(url(`/${bot.id}`)).send({
      name: 'Renamed',
      embeddingCredentialId: bot.embeddingCredentialId,
      embeddingModel: bot.embeddingModel,
    });

    expect(unchanged.status).toBe(200);
    expect(unchanged.body).toMatchObject({ name: 'Renamed', embeddingModel: bot.embeddingModel });
  });
});
