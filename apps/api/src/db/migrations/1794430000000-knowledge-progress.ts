// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { TableIndex } from 'typeorm';

/**
 * Live progress for the admin (Task 3.6, spec §9.3): a crawl reports how many pages it has
 * found, finished and failed, and a source that is being removed says so until its job runs.
 * The unique index stops two concurrent embedding passes from writing a chunk twice.
 */
export class KnowledgeProgress1794430000000 implements MigrationInterface {
  name = 'KnowledgeProgress1794430000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "knowledge_sources" ADD "pages_total" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_sources" ADD "pages_done" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_sources" ADD "pages_failed" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_sources" ADD "warning_count" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."source_status" ADD VALUE IF NOT EXISTS 'deleting'`,
    );
    await queryRunner.createIndex(
      'chunks',
      new TableIndex({
        name: 'chunks_version_model_ordinal',
        columnNames: ['document_version_id', 'embedding_model', 'ordinal'],
        isUnique: true,
      }),
    );
    // One document per canonical URL per source: a sitemap that lists a page twice, or two
    // page jobs racing, must not index it twice (Task 3.8).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "documents_source_url" ON "documents" ("source_id", "url")
        WHERE "url" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "documents_source_url"`);
    await queryRunner.dropIndex('chunks', 'chunks_version_model_ordinal');
    // A Postgres enum value cannot be removed; leaving `deleting` is harmless on a downgrade.
    await queryRunner.query(`ALTER TABLE "knowledge_sources" DROP COLUMN "warning_count"`);
    await queryRunner.query(`ALTER TABLE "knowledge_sources" DROP COLUMN "pages_failed"`);
    await queryRunner.query(`ALTER TABLE "knowledge_sources" DROP COLUMN "pages_done"`);
    await queryRunner.query(`ALTER TABLE "knowledge_sources" DROP COLUMN "pages_total"`);
  }
}
