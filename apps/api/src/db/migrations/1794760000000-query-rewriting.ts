// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryRewriting1794760000000 implements MigrationInterface {
  name = 'QueryRewriting1794760000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bots" ADD "query_rewriting_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD "query_rewriting_applied" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD "query_rewriting_ms" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE "generation_traces" ADD "query_rewriting_failure" text`);
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD CONSTRAINT "generation_traces_query_rewriting_failure_check" CHECK ("query_rewriting_failure" IS NULL OR "query_rewriting_failure" IN ('invalid_output', 'unavailable', 'timeout'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "generation_traces" DROP CONSTRAINT "generation_traces_query_rewriting_failure_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" DROP COLUMN "query_rewriting_failure"`,
    );
    await queryRunner.query(`ALTER TABLE "generation_traces" DROP COLUMN "query_rewriting_ms"`);
    await queryRunner.query(
      `ALTER TABLE "generation_traces" DROP COLUMN "query_rewriting_applied"`,
    );
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "query_rewriting_enabled"`);
  }
}
