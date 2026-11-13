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
  return `documents${String(emailSeq)}@example.com`;
}

interface DocumentViewBody {
  document: { id: string; title: string | null };
  currentVersion: { content: string; warnings: string[] } | null;
  chunks: { ordinal: number; headingPath: string; content: string; tokenCount: number }[];
}

describe('knowledge document viewer', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let workspaceId: string;
  let botId: string;
  let sourceId: string;
  let documentId: string;

  async function createBot(name: string): Promise<string> {
    const credential = await owner
      .post(`/api/v1/workspaces/${workspaceId}/credentials`)
      .send({ provider: 'mock', label: name });
    const bot = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
      name,
      chatCredentialId: (credential.body as { id: string }).id,
      chatModel: 'mock-chat',
    });
    if (bot.status !== 201) throw new Error(`bot: ${bot.text}`);
    return (bot.body as { id: string }).id;
  }

  async function seedDocument(input: {
    botId: string;
    title: string;
    chunks: number;
  }): Promise<string> {
    const source = await t.ds.query<{ id: string }[]>(
      `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, options, status)
       VALUES ($1, $2, 'text', $3, '{}'::jsonb, 'ready') RETURNING id`,
      [workspaceId, input.botId, input.title],
    );
    sourceId = source[0]?.id ?? '';
    const document = await t.ds.query<{ id: string }[]>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, title)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [workspaceId, input.botId, sourceId, input.title],
    );
    const id = document[0]?.id ?? '';
    const version = await t.ds.query<{ id: string }[]>(
      `INSERT INTO document_versions (workspace_id, document_id, content_hash, content, warnings)
       VALUES ($1, $2, 'hash', $3, ARRAY['truncated']::text[])
       RETURNING id`,
      [workspaceId, id, `# ${input.title}\n\nBody.`],
    );
    const versionId = version[0]?.id ?? '';
    await t.ds.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [id, versionId]);
    for (let ordinal = 0; ordinal < input.chunks; ordinal += 1) {
      await t.ds.query(
        `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                             content, token_count, embedding, embedding_model, embedding_dim)
         VALUES ($1, $2, $3, $4, $5, $6, 4, array_fill(0.0, ARRAY[384])::vector,
                 'mock-embed', 384)`,
        [
          workspaceId,
          input.botId,
          versionId,
          ordinal,
          `# ${input.title}`,
          `Chunk ${String(ordinal)}`,
        ],
      );
    }
    documentId = id;
    return id;
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
    botId = await createBot('Help');
    await seedDocument({ botId, title: 'Refunds', chunks: 3 });
  });

  it('returns the source with its documents and version metadata', async () => {
    const res = await owner.get(
      `/api/v1/workspaces/${workspaceId}/bots/${botId}/sources/${sourceId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: sourceId,
      status: 'ready',
      documents: [
        {
          id: documentId,
          title: 'Refunds',
          status: 'active',
          warnings: ['truncated'],
          chunkCount: 3,
        },
      ],
      nextCursor: null,
    });
  });

  it('returns the current version and chunks in ordinal order, without embeddings', async () => {
    const res = await owner.get(
      `/api/v1/workspaces/${workspaceId}/bots/${botId}/documents/${documentId}`,
    );

    expect(res.status).toBe(200);
    const body = res.body as DocumentViewBody;
    expect(body.document.title).toBe('Refunds');
    expect(body.currentVersion).toMatchObject({ warnings: ['truncated'] });
    expect(body.chunks.map((chunk) => chunk.ordinal)).toEqual([0, 1, 2]);
    expect(body.chunks[0]).toMatchObject({ headingPath: '# Refunds', tokenCount: 4 });
    expect(JSON.stringify(body)).not.toContain('embedding');
  });

  it('does not show a document of another bot in the same workspace', async () => {
    const otherBot = await createBot('Other');
    const otherDocument = await seedDocument({ botId: otherBot, title: 'Other', chunks: 1 });

    const res = await owner.get(
      `/api/v1/workspaces/${workspaceId}/bots/${botId}/documents/${otherDocument}`,
    );
    expect(res.status).toBe(404);
  });

  it('refuses agents', async () => {
    const { user: agent, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    await t.ds.query(
      "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agent')",
      [workspaceId, agent.id],
    );
    const agentClient = authed(t, await loginAs(t, agent, password));

    expect(
      (
        await agentClient.get(
          `/api/v1/workspaces/${workspaceId}/bots/${botId}/documents/${documentId}`,
        )
      ).status,
    ).toBe(403);
  });
});
