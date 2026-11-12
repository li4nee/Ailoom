// SPDX-License-Identifier: AGPL-3.0-only
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../../test/helpers/db';
import { createUser } from '../../../../test/helpers/factories';
import { WorkerAppModule } from '../../../app/worker-app.module';
import { loadConfig } from '../../../common/config';
import { MemoryStorage } from '../../../common/storage';
import { asBotId, asUserId, asWorkspaceId } from '../../../db/ids';
import { JobsService } from '../../../jobs';
import { EMBED_CHUNKS_JOB, REEMBED_BOT_JOB } from '../knowledge.jobs';
import { ReembedService } from './reembed.service';

let ds: DataSource;
let worker: INestApplicationContext;
let reembed: ReembedService;
let jobs: JobsService;
let workspaceId: string;
let botId: string;
let embeddingCredentialId: string;
let actorId: string;
let sourceId: string;

const OLD = 'mock-embed';
const ALT = 'mock-embed-alt';
const LARGE = 'mock-embed-large';

async function seedBot(): Promise<void> {
  const slug = `reembed-${Math.random().toString(36).slice(2, 8)}`;
  const { user } = await createUser({ ds }, { email: `${slug}@example.com` });
  actorId = user.id;
  workspaceId =
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO workspaces (name, slug) VALUES ('Reembed', $1) RETURNING id`,
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
  embeddingCredentialId = embed ?? '';
  botId =
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                           embedding_credential_id, embedding_model, embedding_dim)
         VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, $5, 384)
         RETURNING id`,
        [workspaceId, `pk_live_reembed_${slug}`, chat, embed, OLD],
      )
    )[0]?.id ?? '';
  sourceId =
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, options, status)
         VALUES ($1, $2, 'text', 'Docs', '{}'::jsonb, 'ready') RETURNING id`,
        [workspaceId, botId],
      )
    )[0]?.id ?? '';
}

async function seedDocument(title: string, chunks: number): Promise<string> {
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
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [workspaceId, documentId, `hash-${title}`, `# ${title}\n\nBody text.`],
      )
    )[0]?.id ?? '';
  await ds.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
    documentId,
    versionId,
  ]);
  for (let ordinal = 0; ordinal < chunks; ordinal += 1) {
    await ds.query(
      `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, content,
                           token_count, embedding, embedding_model, embedding_dim)
       VALUES ($1, $2, $3, $4, $5, 3, array_fill(0.0, ARRAY[384])::vector, $6, 384)`,
      [workspaceId, botId, versionId, ordinal, `Body ${String(ordinal)}`, OLD],
    );
  }
  return versionId;
}

async function modelsPresent(): Promise<string[]> {
  const rows = await ds.query<{ embedding_model: string }[]>(
    `SELECT DISTINCT embedding_model FROM chunks WHERE workspace_id = $1 AND bot_id = $2
      ORDER BY embedding_model`,
    [workspaceId, botId],
  );
  return rows.map((row) => row.embedding_model);
}

async function botRow(): Promise<{
  embedding_model: string;
  embedding_dim: number;
  pending_embedding_model: string | null;
  last_error: string | null;
}> {
  const rows = await ds.query<
    {
      embedding_model: string;
      embedding_dim: number;
      pending_embedding_model: string | null;
      last_error: string | null;
    }[]
  >(
    `SELECT embedding_model, embedding_dim, pending_embedding_model, last_error
       FROM bots WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, botId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('bot row missing');
  return row;
}

beforeAll(async () => {
  ds = await getTestDataSource();
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
      storage: new MemoryStorage(),
      jobs: { pollingIntervalSeconds: 0.5 },
    }),
    { logger: false },
  );
  reembed = worker.get(ReembedService);
  jobs = worker.get(JobsService);
});

afterAll(async () => {
  await worker.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
  await seedBot();
});

describe('re-embedding', () => {
  it('keeps answering on the old model until the swap, then leaves only the new rows', async () => {
    await seedDocument('One', 2);
    await seedDocument('Two', 2);

    await reembed.start(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      { credentialId: embeddingCredentialId, model: ALT },
      asUserId(actorId),
    );

    await vi.waitFor(
      async () => {
        expect((await botRow()).embedding_model).toBe(ALT);
      },
      { timeout: 15_000, interval: 200 },
    );
    expect((await botRow()).pending_embedding_model).toBeNull();
    // ALT has the same 384 dimensions as the old model: only the model tag separates them.
    expect(await modelsPresent()).toEqual([ALT]);
    const counts = await ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM chunks WHERE workspace_id = $1 AND bot_id = $2`,
      [workspaceId, botId],
    );
    expect(counts[0]?.count).toBe(2);
  });

  it('cancels an older re-embed when the model changes again', async () => {
    await seedDocument('One', 1);

    await reembed.start(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      { credentialId: embeddingCredentialId, model: ALT },
      asUserId(actorId),
    );
    await reembed.start(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      { credentialId: embeddingCredentialId, model: LARGE },
      asUserId(actorId),
    );

    await vi.waitFor(
      async () => {
        expect((await botRow()).embedding_model).toBe(LARGE);
      },
      { timeout: 15_000, interval: 200 },
    );
    expect((await botRow()).embedding_dim).toBe(768);
    expect(await modelsPresent()).toEqual([LARGE]);
  });

  it('leaves the bot on the old model, with an error, when the re-embed fails', async () => {
    await seedDocument('One', 1);

    await ds.query(
      `UPDATE bots
          SET pending_embedding_model = $3, pending_embedding_credential_id = $4,
              pending_embedding_dim = 384, reembed_generation = 1
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, botId, ALT, '00000000-0000-7000-8000-000000000000'],
    );
    await jobs.enqueue(REEMBED_BOT_JOB, {
      workspaceId,
      botId,
      targetModel: ALT,
      targetCredentialId: '00000000-0000-7000-8000-000000000000',
      generation: 1,
    });

    await vi.waitFor(
      async () => {
        expect((await botRow()).last_error).not.toBeNull();
      },
      { timeout: 15_000, interval: 200 },
    );
    const row = await botRow();
    expect(row.embedding_model).toBe(OLD);
    expect(row.pending_embedding_model).toBeNull();
    expect(await modelsPresent()).toEqual([OLD]);
  });

  it('writes both models for content ingested while a re-embed is pending', async () => {
    await ds.query(
      `UPDATE bots
          SET pending_embedding_model = $3, pending_embedding_credential_id = $4,
              pending_embedding_dim = 384, reembed_generation = 1
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, botId, ALT, embeddingCredentialId],
    );
    const versionId = await seedDocument('New', 0);

    await jobs.enqueue(EMBED_CHUNKS_JOB, {
      workspaceId,
      botId,
      documentVersionId: versionId,
      embeddingModel: OLD,
    });

    await vi.waitFor(
      async () => {
        expect(await modelsPresent()).toEqual([OLD, ALT]);
      },
      { timeout: 15_000, interval: 200 },
    );
  });
});
