// SPDX-License-Identifier: AGPL-3.0-only
import { type DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { asBotId, asWorkspaceId } from '../../db/ids';
import { RetrievalRepository } from './retrieval.repository';

let ds: DataSource;
let repo: RetrievalRepository;

interface SeededBot {
  workspaceId: string;
  botId: string;
  versionId: string;
}

function unitVector(dim: number): string {
  return `array_prepend(1.0, array_fill(0.0, ARRAY[${String(dim - 1)}]))`;
}

async function seedWorkspace(
  slug = `retr-${Math.random().toString(36).slice(2, 8)}`,
): Promise<string> {
  const rows = await ds.query<{ id: string }[]>(
    `INSERT INTO workspaces (name, slug) VALUES ('Retrieval', $1) RETURNING id`,
    [slug],
  );
  return rows[0]?.id ?? '';
}

async function seedBot(
  workspaceId: string,
  input: { model?: string; dim?: number } = {},
): Promise<SeededBot> {
  const model = input.model ?? 'm';
  const dim = input.dim ?? 384;
  const credentials = await ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', 'chat'), ($1, 'mock', 'embed') RETURNING id`,
    [workspaceId],
  );
  const [chat, embed] = credentials.map((row) => row.id);
  const bot = await ds.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim)
     VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, $5, $6) RETURNING id`,
    [workspaceId, `pk_live_${Math.random().toString(36).slice(2, 10)}`, chat, embed, model, dim],
  );
  const botId = bot[0]?.id ?? '';
  const source = await ds.query<{ id: string }[]>(
    `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, options, status)
     VALUES ($1, $2, 'text', 'Docs', '{}'::jsonb, 'ready') RETURNING id`,
    [workspaceId, botId],
  );
  const document = await ds.query<{ id: string }[]>(
    `INSERT INTO documents (workspace_id, bot_id, source_id, title)
     VALUES ($1, $2, $3, 'Refunds') RETURNING id`,
    [workspaceId, botId, source[0]?.id],
  );
  const version = await ds.query<{ id: string }[]>(
    `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
     VALUES ($1, $2, 'hash', '# Refunds') RETURNING id`,
    [workspaceId, document[0]?.id],
  );
  const versionId = version[0]?.id ?? '';
  await ds.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
    document[0]?.id,
    versionId,
  ]);
  return { workspaceId, botId, versionId };
}

async function seedChunk(
  bot: SeededBot,
  input: { ordinal: number; model?: string; dim?: number; embedding?: string },
): Promise<string> {
  const dim = input.dim ?? 384;
  const rows = await ds.query<{ id: string }[]>(
    `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                         content, token_count, embedding, embedding_model, embedding_dim)
     VALUES ($1, $2, $3, $4, '# Refunds', $5, 3, (${input.embedding ?? unitVector(dim)})::vector,
             $6, $7) RETURNING id`,
    [
      bot.workspaceId,
      bot.botId,
      bot.versionId,
      input.ordinal,
      `Chunk ${String(input.ordinal)}`,
      input.model ?? 'm',
      dim,
    ],
  );
  return rows[0]?.id ?? '';
}

/** A lot of other bots on the same dimension, so a small bot is a tiny part of the index. */
async function seedBusyDimension(dim: number): Promise<void> {
  const workspaceId = await seedWorkspace();
  for (let index = 0; index < 30; index += 1) {
    const bot = await seedBot(workspaceId, { model: 'm', dim });
    await ds.query(
      `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                           content, token_count, embedding, embedding_model, embedding_dim)
       SELECT $1, $2, $3, n, '# Busy', 'Busy chunk', 2, (${unitVector(dim)})::vector, 'm', $4
         FROM generate_series(0, 999) AS n`,
      [workspaceId, bot.botId, bot.versionId, dim],
    );
  }
  await ds.query('ANALYZE chunks');
}

beforeAll(async () => {
  ds = await getTestDataSource();
  repo = new RetrievalRepository(ds);
});

beforeEach(async () => {
  await resetDatabase(ds);
});

describe('retrieval repository', () => {
  it('does not starve small bots on a busy dimension', async () => {
    await seedBusyDimension(384);
    const small = await seedBot(await seedWorkspace());
    for (let ordinal = 0; ordinal < 20; ordinal += 1) {
      await seedChunk(small, { ordinal });
    }

    const found = await repo.search(asWorkspaceId(small.workspaceId), {
      botId: asBotId(small.botId),
      embeddingModel: 'm',
      dim: 384,
      vector: [1, ...Array<number>(383).fill(0)],
      limit: 8,
    });
    expect(found).toHaveLength(8);

    // The settings are what make this reliable: with iterative scanning off, HNSW would return
    // the globally nearest rows and filter the bot out afterwards, starving it. The planner can
    // sidestep HNSW for a tiny bot here, so the assertion above is the contract this test keeps.
  });

  it('filters by embedding model, so two models never mix', async () => {
    const bot = await seedBot(await seedWorkspace());
    await seedChunk(bot, { ordinal: 0, model: 'a' });
    await seedChunk(bot, { ordinal: 1, model: 'b' });

    const found = await repo.search(asWorkspaceId(bot.workspaceId), {
      botId: asBotId(bot.botId),
      embeddingModel: 'a',
      dim: 384,
      vector: [1, ...Array<number>(383).fill(0)],
      limit: 8,
    });
    expect(found.map((chunk) => chunk.chunkId)).toHaveLength(1);
    expect(
      await repo.countReadyChunks(asWorkspaceId(bot.workspaceId), asBotId(bot.botId), 'a'),
    ).toBe(1);
  });

  it('returns only chunks of the current version', async () => {
    const bot = await seedBot(await seedWorkspace());
    await seedChunk(bot, { ordinal: 0 });
    const oldVersion = await ds.query<{ id: string }[]>(
      `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
       SELECT workspace_id, document_id, 'old', '# Old' FROM document_versions WHERE id = $1
       RETURNING id`,
      [bot.versionId],
    );
    await ds.query(
      `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                           content, token_count, embedding, embedding_model, embedding_dim)
       VALUES ($1, $2, $3, 0, '# Old', 'Old chunk', 2, (${unitVector(384)})::vector, 'm', 384)`,
      [bot.workspaceId, bot.botId, oldVersion[0]?.id],
    );

    const found = await repo.search(asWorkspaceId(bot.workspaceId), {
      botId: asBotId(bot.botId),
      embeddingModel: 'm',
      dim: 384,
      vector: [1, ...Array<number>(383).fill(0)],
      limit: 8,
    });
    expect(found.map((chunk) => chunk.content)).toEqual(['Chunk 0']);
  });

  it('never crosses workspaces', async () => {
    const mine = await seedBot(await seedWorkspace());
    const theirs = await seedBot(await seedWorkspace());
    await seedChunk(theirs, { ordinal: 0 });

    const found = await repo.search(asWorkspaceId(mine.workspaceId), {
      botId: asBotId(theirs.botId),
      embeddingModel: 'm',
      dim: 384,
      vector: [1, ...Array<number>(383).fill(0)],
      limit: 8,
    });
    expect(found).toEqual([]);
  });

  it('scores 1 - cosine distance and sorts descending', async () => {
    const bot = await seedBot(await seedWorkspace());
    await seedChunk(bot, {
      ordinal: 0,
      embedding: `array_prepend(0.0, array_prepend(1.0, array_fill(0.0, ARRAY[382])))`,
    });
    await seedChunk(bot, { ordinal: 1, embedding: unitVector(384) });

    const found = await repo.search(asWorkspaceId(bot.workspaceId), {
      botId: asBotId(bot.botId),
      embeddingModel: 'm',
      dim: 384,
      vector: [1, ...Array<number>(383).fill(0)],
      limit: 8,
    });
    expect(found.map((chunk) => chunk.rank)).toEqual([1, 2]);
    expect(found[0]?.score).toBeCloseTo(1, 5);
    expect(found[1]?.score).toBeCloseTo(0, 5);
    expect(found[0]?.score).toBeGreaterThan(found[1]?.score ?? 1);
  });

  it('works for 3072-dim bots through the halfvec index', async () => {
    const bot = await seedBot(await seedWorkspace(), { dim: 3072 });
    const zeros = Array<number>(3071).fill(0).join(',');
    await seedChunk(bot, {
      ordinal: 0,
      dim: 3072,
      embedding: `array_prepend(1.0, ARRAY[${zeros}])::halfvec(3072)::vector`,
    });

    const found = await repo.search(asWorkspaceId(bot.workspaceId), {
      botId: asBotId(bot.botId),
      embeddingModel: 'm',
      dim: 3072,
      vector: [1, ...Array<number>(3071).fill(0)],
      limit: 8,
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.score).toBeCloseTo(1, 5);
  });

  it('uses the matching per-dimension HNSW index', async () => {
    await seedBusyDimension(384);
    const bot = await seedBot(await seedWorkspace());
    await ds.query(
      `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                           content, token_count, embedding, embedding_model, embedding_dim)
       SELECT $1, $2, $3, n, '# Refunds', 'Chunk', 3, (${unitVector(384)})::vector, 'm', 384
         FROM generate_series(0, 1999) AS n`,
      [bot.workspaceId, bot.botId, bot.versionId],
    );
    await ds.query('ANALYZE chunks');
    await ds.query('ANALYZE chunks');

    const plan = await ds.transaction(async (manager) => {
      await manager.query('SET LOCAL enable_seqscan = off');
      await manager.query('SET LOCAL enable_bitmapscan = off');
      const rows = await manager.query<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (FORMAT TEXT)
         SELECT c.id
           FROM chunks c
           JOIN documents d ON d.current_version_id = c.document_version_id
          WHERE c.embedding_dim = 384 AND c.embedding_model = 'm'
          ORDER BY c.embedding::vector(384) <=> $1::vector(384)
          LIMIT 8`,
        [`[1,${Array<number>(383).fill(0).join(',')}]`],
      );
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('chunks_embedding_384_hnsw');
  });
});
