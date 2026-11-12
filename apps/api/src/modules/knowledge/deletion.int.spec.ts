// SPDX-License-Identifier: AGPL-3.0-only
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser } from '../../../test/helpers/factories';
import { WorkerAppModule } from '../../app/worker-app.module';
import { loadConfig } from '../../common/config';
import { MemoryStorage } from '../../common/storage';
import { asBotId, asUserId, asWorkspaceId } from '../../db/ids';
import { BotsService } from '../bots/bots.service';
import { DeletionService } from './deletion.service';

let ds: DataSource;
let worker: INestApplicationContext;
let storage: MemoryStorage;
let deletion: DeletionService;
let bots: BotsService;
let workspaceId: string;
let botId: string;
let actorId: string;

async function seedBot(): Promise<void> {
  const { user } = await createUser(
    { ds },
    { email: `delete-${Math.random().toString(36).slice(2, 8)}@example.com` },
  );
  actorId = user.id;
  const slug = `delete-${Math.random().toString(36).slice(2, 8)}`;
  workspaceId =
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO workspaces (name, slug) VALUES ('Delete', $1) RETURNING id`,
        [slug],
      )
    )[0]?.id ?? '';
  const credentials = await ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', 'chat'), ($1, 'mock', 'embed')
     RETURNING id`,
    [workspaceId],
  );
  const [chat, embed] = credentials.map((row) => row.id);
  botId =
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                           embedding_credential_id, embedding_model, embedding_dim)
         VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'mock-embed', 384)
         RETURNING id`,
        [workspaceId, `pk_live_delete_${slug}`, chat, embed],
      )
    )[0]?.id ?? '';
}

interface Seeded {
  sourceId: string;
  documentId: string;
  versionId: string;
  chunkId: string;
  storageKey: string;
}

async function seedSource(title: string): Promise<Seeded> {
  const storageKey = `${workspaceId}/${Math.random().toString(36).slice(2, 10)}`;
  await storage.put(storageKey, Buffer.from('blob'));
  const fileId =
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO files (workspace_id, storage_key, filename, mime_type, size_bytes, sha256)
         VALUES ($1, $2, 'notes.md', 'text/markdown', 4, 'hash') RETURNING id`,
        [workspaceId, storageKey],
      )
    )[0]?.id ?? '';
  const sourceId =
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, file_key, options, status)
         VALUES ($1, $2, 'file', $3, $4, $5::jsonb, 'ready') RETURNING id`,
        [
          workspaceId,
          botId,
          title,
          storageKey,
          JSON.stringify({ fileId, detectedType: 'markdown' }),
        ],
      )
    )[0]?.id ?? '';
  const documentId =
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO documents (workspace_id, bot_id, source_id, title)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [workspaceId, botId, sourceId, title],
      )
    )[0]?.id ?? '';
  const versionId =
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
         VALUES ($1, $2, 'hash', 'content') RETURNING id`,
        [workspaceId, documentId],
      )
    )[0]?.id ?? '';
  const chunkId =
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, content,
                             token_count, embedding, embedding_model, embedding_dim)
         VALUES ($1, $2, $3, 0, 'content', 1, array_fill(0.0, ARRAY[384])::vector,
                 'mock-embed', 384) RETURNING id`,
        [workspaceId, botId, versionId],
      )
    )[0]?.id ?? '';
  await ds.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
    documentId,
    versionId,
  ]);
  return { sourceId, documentId, versionId, chunkId, storageKey };
}

async function counts(): Promise<Record<string, number>> {
  const rows = await ds.query<
    { documents: number; versions: number; chunks: number; files: number }[]
  >(
    `SELECT (SELECT count(*)::int FROM documents WHERE workspace_id = $1) AS documents,
            (SELECT count(*)::int FROM document_versions WHERE workspace_id = $1) AS versions,
            (SELECT count(*)::int FROM chunks WHERE workspace_id = $1) AS chunks,
            (SELECT count(*)::int FROM files WHERE workspace_id = $1) AS files`,
    [workspaceId],
  );
  return rows[0] ?? {};
}

beforeAll(async () => {
  ds = await getTestDataSource();
  storage = new MemoryStorage();
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: inject('databaseUrl'),
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
  });
  worker = await NestFactory.createApplicationContext(
    WorkerAppModule.register(config, {
      dataSource: ds,
      storage,
      jobs: { pollingIntervalSeconds: 0.5 },
    }),
    { logger: false },
  );
  deletion = worker.get(DeletionService);
  bots = worker.get(BotsService);
});

afterAll(async () => {
  await worker.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
  storage.blobs.clear();
  await seedBot();
});

describe('knowledge deletion', () => {
  it('removes a source and everything it indexed, leaving other sources alone', async () => {
    const doomed = await seedSource('Doomed');
    const kept = await seedSource('Kept');

    await expect(deletion.purgeSource(asWorkspaceId(workspaceId), doomed.sourceId)).resolves.toBe(
      true,
    );

    const rows = await ds.query<{ source_id: string }[]>(
      `SELECT source_id FROM documents WHERE workspace_id = $1`,
      [workspaceId],
    );
    expect(rows.map((row) => row.source_id)).toEqual([kept.sourceId]);
    expect(await counts()).toMatchObject({ documents: 1, versions: 1, chunks: 1, files: 1 });
    expect(await storage.exists(doomed.storageKey)).toBe(false);
    expect(await storage.exists(kept.storageKey)).toBe(true);
  });

  it('keeps chunk ids in a trace, which has no foreign key to chunks', async () => {
    const seeded = await seedSource('Traced');
    await ds.query(
      `INSERT INTO generation_traces (workspace_id, bot_id, origin, decision, retrieval)
       VALUES ($1, $2, 'widget', 'answered', $3::jsonb)`,
      [workspaceId, botId, JSON.stringify([{ chunk_id: seeded.chunkId, score: 0.9 }])],
    );

    await deletion.purgeSource(asWorkspaceId(workspaceId), seeded.sourceId);

    const traces = await ds.query<{ retrieval: { chunk_id: string }[] }[]>(
      `SELECT retrieval FROM generation_traces WHERE workspace_id = $1`,
      [workspaceId],
    );
    expect(traces[0]?.retrieval).toEqual([{ chunk_id: seeded.chunkId, score: 0.9 }]);
  });

  it('is idempotent when the source is already gone', async () => {
    const seeded = await seedSource('Twice');
    await deletion.purgeSource(asWorkspaceId(workspaceId), seeded.sourceId);
    await expect(deletion.purgeSource(asWorkspaceId(workspaceId), seeded.sourceId)).resolves.toBe(
      false,
    );
    expect(await counts()).toEqual({ documents: 0, versions: 0, chunks: 0, files: 0 });
  });

  it('purges every source when a bot is soft-deleted', async () => {
    await seedSource('One');
    await seedSource('Two');

    await bots.delete(asWorkspaceId(workspaceId), asBotId(botId), asUserId(actorId));
    await vi.waitFor(
      async () => {
        expect(await counts()).toEqual({ documents: 0, versions: 0, chunks: 0, files: 0 });
      },
      { timeout: 15_000, interval: 200 },
    );
    const sources = await ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM knowledge_sources WHERE workspace_id = $1`,
      [workspaceId],
    );
    expect(sources[0]?.count).toBe(0);
  });
});
