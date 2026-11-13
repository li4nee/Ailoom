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

let emailSeq = 0;

function nextEmail(): string {
  emailSeq += 1;
  return `retrieval${String(emailSeq)}@example.com`;
}

interface TestRetrievalBody {
  embeddingModel: string;
  threshold: number;
  results: {
    rank: number;
    score: number;
    used: boolean;
    chunkId: string;
    documentId: string;
    title: string;
    url: string | null;
    headingPath: string;
    preview: string;
  }[];
}

describe('test retrieval', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let workspaceId: string;
  let botId: string;

  async function seedChunks(count: number): Promise<void> {
    const source = await t.ds.query<{ id: string }[]>(
      `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, options, status)
       VALUES ($1, $2, 'text', 'Docs', '{}'::jsonb, 'ready') RETURNING id`,
      [workspaceId, botId],
    );
    const document = await t.ds.query<{ id: string }[]>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, title)
       VALUES ($1, $2, $3, 'Refund policy') RETURNING id`,
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
       SELECT $1, $2, $3, n, '# Refunds', repeat('Refund text. ', 40), 40,
              (array_prepend(($4 + n)::real / $5, array_fill(0.0, ARRAY[383])))::vector,
              'mock-embed', 384
         FROM generate_series(0, $6) AS n`,
      [workspaceId, botId, version[0]?.id, count, count, count - 1],
    );
  }

  function url(): string {
    return `/api/v1/workspaces/${workspaceId}/bots/${botId}/test-retrieval`;
  }

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    workspaceId = (await createWorkspace(t, user, 'Acme')).id;
    owner = authed(t, await loginAs(t, user, password));
    await t.ds.query(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'local', 'Built-in (local)')`,
      [workspaceId],
    );
    const embedding = await owner
      .post(`/api/v1/workspaces/${workspaceId}/credentials`)
      .send({ provider: 'mock', label: 'Embed' });
    const chat = await owner
      .post(`/api/v1/workspaces/${workspaceId}/credentials`)
      .send({ provider: 'mock', label: 'Chat' });
    const bot = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
      name: 'Help',
      chatCredentialId: (chat.body as { id: string }).id,
      chatModel: 'mock-chat',
      embeddingCredentialId: (embedding.body as { id: string }).id,
      embeddingModel: 'mock-embed',
    });
    if (bot.status !== 201) throw new Error(`bot: ${bot.text}`);
    botId = (bot.body as { id: string }).id;
    await t.ds.query(`UPDATE bots SET retrieval_threshold = -1 WHERE id = $1`, [botId]);
  });

  it('returns eight scored candidates and flags the five the chat would use', async () => {
    await seedChunks(8);

    const res = await owner.post(url()).send({ query: 'How do refunds work?' });

    expect(res.status).toBe(200);
    const body = res.body as TestRetrievalBody;
    expect(body.embeddingModel).toBe('mock-embed');
    expect(body.threshold).toBe(-1);
    expect(body.results).toHaveLength(8);
    expect(body.results.map((result) => result.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(body.results.filter((result) => result.used).map((result) => result.rank)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(body.results[0]).toMatchObject({
      title: 'Refund policy',
      headingPath: '# Refunds',
    });
    expect(body.results[0]?.preview.length).toBeLessThanOrEqual(300);
    expect(body.results[0]?.preview.startsWith('Refund text.')).toBe(true);
  });

  it('returns no results for a bot without knowledge', async () => {
    const res = await owner.post(url()).send({ query: 'Anything?' });
    expect(res.status).toBe(200);
    expect((res.body as TestRetrievalBody).results).toEqual([]);
  });

  it('refuses agents and queries over 2000 characters', async () => {
    const { user: agent, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    await t.ds.query(
      "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agent')",
      [workspaceId, agent.id],
    );
    const agentClient = authed(t, await loginAs(t, agent, password));
    expect((await agentClient.post(url()).send({ query: 'Hi' })).status).toBe(403);

    expect((await owner.post(url()).send({ query: 'a'.repeat(2001) })).status).toBe(400);
  });
});
