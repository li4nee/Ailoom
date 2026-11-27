// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RetrievalReranking1794750000000 implements MigrationInterface {
  name = 'RetrievalReranking1794750000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bots" ADD "reranking_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD "reranking_applied" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD "reranking_ms" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE "generation_traces" ADD "reranking_failure" text`);
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD CONSTRAINT "generation_traces_reranking_failure_check" CHECK ("reranking_failure" IS NULL OR "reranking_failure" IN ('invalid_scores', 'unavailable', 'timeout'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "generation_traces" DROP CONSTRAINT "generation_traces_reranking_failure_check"`,
    );
    await queryRunner.query(`ALTER TABLE "generation_traces" DROP COLUMN "reranking_failure"`);
    await queryRunner.query(`ALTER TABLE "generation_traces" DROP COLUMN "reranking_ms"`);
    await queryRunner.query(`ALTER TABLE "generation_traces" DROP COLUMN "reranking_applied"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "reranking_enabled"`);
  }
}
