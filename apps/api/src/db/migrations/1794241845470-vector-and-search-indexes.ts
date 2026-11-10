// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index name -> definition. Hand-written because TypeORM cannot express partial expression
 * indexes, operator classes or DESC keys; each is declared on its entity with
 * `synchronize: false` so `db:check` leaves it alone.
 *
 * - One partial HNSW index per shipped embedding dimension (spec §12.6). `chunks.embedding` is
 *   untyped, so each index casts to its dimension and covers only rows of that dimension; the
 *   retrieval query casts the same way, so the planner picks the matching index. HNSW on
 *   `vector` stops at 2,000 dimensions, so 3072 uses `halfvec` (limit 4,000).
 * - GIN indexes on the generated `tsv` columns for hybrid and conversation search.
 * - Inbox, message timeline and trace listing indexes (spec §9.4, §9.5).
 * - `model_prices_unique`: one price per (provider, model, workspace). NULL workspace ids
 *   (built-in defaults) would never collide in a plain unique index, so they are coalesced
 *   to the nil uuid.
 */
const INDEXES: readonly (readonly [name: string, definition: string])[] = [
  ...[384, 768, 1024, 1536].map(
    (dim) =>
      [
        `chunks_embedding_${String(dim)}_hnsw`,
        `ON chunks USING hnsw ((embedding::vector(${String(dim)})) vector_cosine_ops) WHERE embedding_dim = ${String(dim)}`,
      ] as const,
  ),
  [
    'chunks_embedding_3072_hnsw_halfvec',
    'ON chunks USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops) WHERE embedding_dim = 3072',
  ],
  ['chunks_tsv_gin', 'ON chunks USING gin (tsv)'],
  ['messages_tsv_gin', 'ON messages USING gin (tsv)'],
  ['conversations_inbox', 'ON conversations (workspace_id, status, last_message_at DESC)'],
  ['messages_conversation_created', 'ON messages (conversation_id, created_at)'],
  ['generation_traces_ws_created', 'ON generation_traces (workspace_id, created_at)'],
  ['generation_traces_bot_created', 'ON generation_traces (bot_id, created_at)'],
  ['generation_traces_decision_created', 'ON generation_traces (decision, created_at)'],
];

const UNIQUE_INDEXES: readonly (readonly [name: string, definition: string])[] = [
  [
    'model_prices_unique',
    "ON model_prices (provider, model, coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'))",
  ],
];

/** Vector, full-text and listing indexes, built without locking writes. */
export class VectorAndSearchIndexes1794241845470 implements MigrationInterface {
  name = 'VectorAndSearchIndexes1794241845470';

  // CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
  transaction = false as const;

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, definition] of INDEXES) {
      await queryRunner.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${name}" ${definition}`);
    }
    for (const [name, definition] of UNIQUE_INDEXES) {
      await queryRunner.query(
        `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "${name}" ${definition}`,
      );
    }
  }

  // Not CONCURRENTLY: TypeORM reverts inside a transaction whatever `transaction` says, and a
  // revert is a rare maintenance step where a short exclusive lock is acceptable.
  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [name] of [...UNIQUE_INDEXES, ...INDEXES].reverse()) {
      await queryRunner.query(`DROP INDEX IF EXISTS "${name}"`);
    }
  }
}
