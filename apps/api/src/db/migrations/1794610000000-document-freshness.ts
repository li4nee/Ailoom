// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DocumentFreshness1794610000000 implements MigrationInterface {
  name = 'DocumentFreshness1794610000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" ADD "unreachable_since" timestamptz`);
    await queryRunner.query(
      `CREATE INDEX "knowledge_sources_recrawl_due_idx"
         ON "knowledge_sources" ("status", "recrawl_interval")
         WHERE "recrawl_interval" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."knowledge_sources_recrawl_due_idx"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "unreachable_since"`);
  }
}
