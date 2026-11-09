// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SchemaCoreVectorSearch1731160000001 implements MigrationInterface {
  name = 'SchemaCoreVectorSearch1731160000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable pgvector extension (already enabled in Extensions migration, but safe to include)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

    // Update chunks.embedding column type to vector(1536) - default dimension for OpenAI embeddings
    // Note: The actual dimension will vary by provider. We use a flexible approach.
    await queryRunner.query(`
      ALTER TABLE chunks
      ALTER COLUMN embedding TYPE vector(1536) USING embedding::vector(1536);
    `);

    // Create HNSW index on chunks.embedding for vector similarity search
    // Using cosine distance (vector_cosine_ops) as default
    // m=16, ef_construction=64 are reasonable defaults
    await queryRunner.query(`
      CREATE INDEX chunks_embedding_hnsw_idx
      ON chunks
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
    `);

    // Create GIN index on chunks.tsv for full-text search
    await queryRunner.query(`
      CREATE INDEX chunks_tsv_gin_idx
      ON chunks
      USING gin (tsv);
    `);

    // Create GIN index on messages.tsv for full-text search
    await queryRunner.query(`
      CREATE INDEX messages_tsv_gin_idx
      ON messages
      USING gin (tsv);
    `);

    // Create function to update tsv column for chunks
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_chunks_tsv()
      RETURNS trigger AS $$
      BEGIN
        NEW.tsv := to_tsvector('english', COALESCE(NEW.content, ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create trigger to update chunks.tsv on insert/update
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS chunks_tsv_trigger ON chunks;
      CREATE TRIGGER chunks_tsv_trigger
      BEFORE INSERT OR UPDATE ON chunks
      FOR EACH ROW EXECUTE FUNCTION update_chunks_tsv();
    `);

    // Create function to update tsv column for messages
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_messages_tsv()
      RETURNS trigger AS $$
      BEGIN
        NEW.tsv := to_tsvector('english', COALESCE(NEW.content, ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create trigger to update messages.tsv on insert/update
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS messages_tsv_trigger ON messages;
      CREATE TRIGGER messages_tsv_trigger
      BEFORE INSERT OR UPDATE ON messages
      FOR EACH ROW EXECUTE FUNCTION update_messages_tsv();
    `);

    // Backfill tsv for existing chunks
    await queryRunner.query(`
      UPDATE chunks SET tsv = to_tsvector('english', COALESCE(content, ''));
    `);

    // Backfill tsv for existing messages
    await queryRunner.query(`
      UPDATE messages SET tsv = to_tsvector('english', COALESCE(content, ''));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop triggers
    await queryRunner.query(`DROP TRIGGER IF EXISTS messages_tsv_trigger ON messages;`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS chunks_tsv_trigger ON chunks;`);

    // Drop functions
    await queryRunner.query(`DROP FUNCTION IF EXISTS update_messages_tsv();`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS update_chunks_tsv();`);

    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS messages_tsv_gin_idx;`);
    await queryRunner.query(`DROP INDEX IF EXISTS chunks_tsv_gin_idx;`);
    await queryRunner.query(`DROP INDEX IF EXISTS chunks_embedding_hnsw_idx;`);

    // Revert embedding column type back to text
    await queryRunner.query(`
      ALTER TABLE chunks
      ALTER COLUMN embedding TYPE text USING embedding::text;
    `);
  }
}
