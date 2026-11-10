// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../test/helpers/db';

let ds: DataSource;

beforeAll(async () => {
  ds = await getTestDataSource();
});

beforeEach(async () => {
  await resetDatabase(ds);
});

async function tables(): Promise<string[]> {
  const rows = await ds.query<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  return rows.map((r) => r.tablename);
}

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await ds.query<T[]>(sql, params);
  if (row === undefined) throw new Error(`no row: ${sql}`);
  return row;
}

interface Seed {
  workspaceId: string;
  botId: string;
  versionId: string;
}

/** A workspace with a local credential, a 384-dim bot, one source, document and version. */
async function seedBot(): Promise<Seed> {
  const { id: workspaceId } = await one<{ id: string }>(
    `INSERT INTO workspaces (name, slug) VALUES ('Acme', 'acme') RETURNING id`,
  );
  const { id: credentialId } = await one<{ id: string }>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'local', 'Built-in') RETURNING id`,
    [workspaceId],
  );
  const { id: botId } = await one<{ id: string }>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim, no_answer_behavior)
     VALUES ($1, 'Support', 'pk_live_test', $2, 'mock-chat', $2, 'bge-small-en-v1.5', 384,
             'offer_handoff')
     RETURNING id`,
    [workspaceId, credentialId],
  );
  const { id: sourceId } = await one<{ id: string }>(
    `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title)
     VALUES ($1, $2, 'text', 'FAQ') RETURNING id`,
    [workspaceId, botId],
  );
  const { id: documentId } = await one<{ id: string }>(
    `INSERT INTO documents (workspace_id, bot_id, source_id, title)
     VALUES ($1, $2, $3, 'FAQ') RETURNING id`,
    [workspaceId, botId, sourceId],
  );
  const { id: versionId } = await one<{ id: string }>(
    `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
     VALUES ($1, $2, 'hash', 'Refund window') RETURNING id`,
    [workspaceId, documentId],
  );
  await ds.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [
    versionId,
    documentId,
  ]);
  return { workspaceId, botId, versionId };
}

function vectorLiteral(dim: number, seed: number): string {
  return `[${Array.from({ length: dim }, (_, i) => Math.sin(seed * 31 + i).toFixed(6)).join(',')}]`;
}

async function insertChunk(
  seed: Seed,
  ordinal: number,
  content: string,
  dim = 384,
): Promise<string> {
  const { id } = await one<{ id: string }>(
    `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, content, token_count,
                         embedding, embedding_model, embedding_dim)
     VALUES ($1, $2, $3, $4, $5, 3, $6::vector, 'bge-small-en-v1.5', $7)
     RETURNING id`,
    [
      seed.workspaceId,
      seed.botId,
      seed.versionId,
      ordinal,
      content,
      vectorLiteral(dim, ordinal),
      dim,
    ],
  );
  return id;
}

describe('core schema (spec §9.2–§9.5)', () => {
  it('has all core tables', async () => {
    expect(await tables()).toEqual(
      expect.arrayContaining([
        'provider_credentials',
        'bots',
        'prompt_versions',
        'knowledge_sources',
        'documents',
        'document_versions',
        'chunks',
        'contacts',
        'conversations',
        'messages',
        'generation_traces',
        'usage_daily',
        'model_prices',
      ]),
    );
  });

  it.each([
    'chunks_embedding_384_hnsw',
    'chunks_embedding_768_hnsw',
    'chunks_embedding_1024_hnsw',
    'chunks_embedding_1536_hnsw',
    'chunks_embedding_3072_hnsw_halfvec',
    'chunks_tsv_gin',
    'messages_tsv_gin',
    'conversations_inbox',
    'messages_conversation_created',
    'generation_traces_ws_created',
    'generation_traces_bot_created',
    'generation_traces_decision_created',
    'model_prices_unique',
  ])('has index %s', async (name) => {
    expect(await ds.query('SELECT 1 FROM pg_indexes WHERE indexname=$1', [name])).toHaveLength(1);
  });

  it('uses the 384 HNSW index for a bot-filtered query', async () => {
    const seed = await seedBot();
    for (let i = 0; i < 200; i++) await insertChunk(seed, i, `chunk ${String(i)}`);

    const plan = await ds.transaction(async (m) => {
      await m.query('SET LOCAL enable_seqscan = off');
      // On 200 rows sorting everything is cheaper than any index, so the planner would not pick
      // HNSW on cost alone. Ruling out the sort asks the real question: can the partial index
      // (its cast expression and dimension predicate) serve the ordered, bot-filtered query?
      await m.query('SET LOCAL enable_sort = off');
      await m.query('SET LOCAL hnsw.iterative_scan = relaxed_order');
      // The candidate query of spec §13.1.
      const rows = await m.query<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN
         WITH candidates AS (
           SELECT c.id, c.content, c.heading_path, c.metadata, d.title, d.url,
                  c.embedding::vector(384) <=> $1::vector(384) AS distance
             FROM chunks c
             JOIN documents d ON d.current_version_id = c.document_version_id
            WHERE c.bot_id = $2
              AND c.workspace_id = $3
              AND c.embedding_dim = 384
              AND c.embedding_model = $4
            ORDER BY distance
            LIMIT 8
         )
         SELECT *, 1 - distance AS score FROM candidates ORDER BY distance`,
        [vectorLiteral(384, 1000), seed.botId, seed.workspaceId, 'bge-small-en-v1.5'],
      );
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });

    expect(plan).toContain('chunks_embedding_384_hnsw');
  });

  it('defaults allowed_origins and allowed_link_domains to empty', async () => {
    const { botId } = await seedBot();
    const row = await one<{ allowed_origins: string[]; allowed_link_domains: string[] }>(
      'SELECT allowed_origins, allowed_link_domains FROM bots WHERE id = $1',
      [botId],
    );
    expect(row).toEqual({ allowed_origins: [], allowed_link_domains: [] });
  });

  it('generates tsv columns', async () => {
    const seed = await seedBot();
    const chunkId = await insertChunk(seed, 0, 'Refund window');
    expect(
      await ds.query(
        `SELECT 1 FROM chunks WHERE id = $1 AND tsv @@ to_tsquery('simple', 'refund')`,
        [chunkId],
      ),
    ).toHaveLength(1);

    const { id: contactId } = await one<{ id: string }>(
      'INSERT INTO contacts (workspace_id) VALUES ($1) RETURNING id',
      [seed.workspaceId],
    );
    const { id: conversationId } = await one<{ id: string }>(
      `INSERT INTO conversations (workspace_id, bot_id, contact_id) VALUES ($1, $2, $3) RETURNING id`,
      [seed.workspaceId, seed.botId, contactId],
    );
    await ds.query(
      `INSERT INTO messages (workspace_id, conversation_id, role, content)
       VALUES ($1, $2, 'visitor', 'Where is my refund?')`,
      [seed.workspaceId, conversationId],
    );
    expect(
      await ds.query(
        `SELECT 1 FROM messages WHERE tsv @@ websearch_to_tsquery('simple', 'refund')`,
      ),
    ).toHaveLength(1);
  });

  it('keeps agent messages when their author is deleted (author_user_id ON DELETE SET NULL)', async () => {
    const seed = await seedBot();
    const { id: userId } = await one<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ('agent@example.com', 'x') RETURNING id`,
    );
    const { id: contactId } = await one<{ id: string }>(
      'INSERT INTO contacts (workspace_id) VALUES ($1) RETURNING id',
      [seed.workspaceId],
    );
    const { id: conversationId } = await one<{ id: string }>(
      `INSERT INTO conversations (workspace_id, bot_id, contact_id) VALUES ($1, $2, $3) RETURNING id`,
      [seed.workspaceId, seed.botId, contactId],
    );
    const { id: messageId } = await one<{ id: string }>(
      `INSERT INTO messages (workspace_id, conversation_id, role, author_user_id, content)
       VALUES ($1, $2, 'agent', $3, 'Hello') RETURNING id`,
      [seed.workspaceId, conversationId, userId],
    );

    await ds.query('DELETE FROM users WHERE id = $1', [userId]);

    expect(
      await one('SELECT author_user_id, content FROM messages WHERE id = $1', [messageId]),
    ).toEqual({ author_user_id: null, content: 'Hello' });
  });

  it('defaults a bot to offering a handoff when it has no answer', async () => {
    const seed = await seedBot();
    const { id } = await one<{ id: string }>(
      `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                         embedding_credential_id, embedding_model, embedding_dim)
       SELECT workspace_id, 'Second', 'pk_live_second', chat_credential_id, chat_model,
              embedding_credential_id, embedding_model, embedding_dim
         FROM bots WHERE id = $1
       RETURNING id`,
      [seed.botId],
    );
    expect(await one('SELECT no_answer_behavior FROM bots WHERE id = $1', [id])).toEqual({
      no_answer_behavior: 'offer_handoff',
    });
  });

  it('keeps a generation trace when its conversation is deleted (conversation_id ON DELETE SET NULL)', async () => {
    const seed = await seedBot();
    const { id: contactId } = await one<{ id: string }>(
      'INSERT INTO contacts (workspace_id) VALUES ($1) RETURNING id',
      [seed.workspaceId],
    );
    const { id: conversationId } = await one<{ id: string }>(
      `INSERT INTO conversations (workspace_id, bot_id, contact_id) VALUES ($1, $2, $3) RETURNING id`,
      [seed.workspaceId, seed.botId, contactId],
    );
    const { id: traceId } = await one<{ id: string }>(
      `INSERT INTO generation_traces (workspace_id, bot_id, conversation_id, origin, decision,
                                      cost_usd)
       VALUES ($1, $2, $3, 'widget', 'answered', 0.012) RETURNING id`,
      [seed.workspaceId, seed.botId, conversationId],
    );

    await ds.query('DELETE FROM conversations WHERE id = $1', [conversationId]);

    // The trace carries cost, which the usage page sums: it must outlive the conversation.
    expect(
      await one('SELECT conversation_id, cost_usd FROM generation_traces WHERE id = $1', [traceId]),
    ).toEqual({ conversation_id: null, cost_usd: '0.012000' });
  });

  it.each([
    ['chunks', 'chunks_bot_id'],
    ['documents', 'documents_bot_id'],
    ['generation_traces', 'generation_traces_trigger_message_id'],
    ['generation_traces', 'generation_traces_prompt_version_id'],
  ])('indexes the foreign key column behind %s (%s)', async (table, name) => {
    expect(
      await ds.query('SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2', [
        table,
        name,
      ]),
    ).toHaveLength(1);
  });

  it('allows one price per provider, model and workspace, built-in defaults included', async () => {
    const insert = `INSERT INTO model_prices (provider, model, input_per_mtok_usd, output_per_mtok_usd)
                    VALUES ('openai', 'gpt-x', 1, 2)`;
    await ds.query(insert);
    await expect(ds.query(insert)).rejects.toMatchObject({ code: '23505' });
  });

  it('refuses to delete a credential a bot still uses', async () => {
    const { workspaceId } = await seedBot();
    await expect(
      ds.query('DELETE FROM provider_credentials WHERE workspace_id = $1', [workspaceId]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('deletes everything with the workspace', async () => {
    const seed = await seedBot();
    await insertChunk(seed, 0, 'Refund window');

    await ds.query('DELETE FROM workspaces WHERE id = $1', [seed.workspaceId]);

    for (const table of ['provider_credentials', 'bots', 'documents', 'chunks']) {
      expect(await ds.query(`SELECT 1 FROM ${table}`)).toHaveLength(0);
    }
  });

  it('lets each workspace-owned table filter by an indexed workspace_id', async () => {
    const rows = await ds.query<{ tablename: string }[]>(
      `SELECT t.relname AS tablename
         FROM pg_class t
        WHERE t.relname = ANY($1)
          AND NOT EXISTS (
            SELECT 1 FROM pg_index i
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
             WHERE i.indrelid = t.oid AND a.attname = 'workspace_id')`,
      [
        [
          'provider_credentials',
          'bots',
          'prompt_versions',
          'knowledge_sources',
          'documents',
          'document_versions',
          'chunks',
          'contacts',
          'conversations',
          'messages',
          'generation_traces',
          'usage_daily',
        ],
      ],
    );
    expect(rows).toEqual([]);
  });
});
