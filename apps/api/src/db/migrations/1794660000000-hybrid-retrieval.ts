// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HybridRetrieval1794660000000 implements MigrationInterface {
  name = 'HybridRetrieval1794660000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bots" ADD "retrieval_mode" text NOT NULL DEFAULT 'vector'`,
    );
    await queryRunner.query(
      `ALTER TABLE "bots" ADD CONSTRAINT "bots_retrieval_mode_check" CHECK ("retrieval_mode" IN ('vector', 'hybrid'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD "retrieval_mode" text NOT NULL DEFAULT 'vector'`,
    );
    await queryRunner.query(`ALTER TABLE "generation_traces" ADD "retrieval_ms" integer`);
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD "retrieval_cost_usd" numeric(12,6)`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD CONSTRAINT "generation_traces_retrieval_mode_check" CHECK ("retrieval_mode" IN ('vector', 'hybrid'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "generation_traces" DROP CONSTRAINT "generation_traces_retrieval_mode_check"`,
    );
    await queryRunner.query(`ALTER TABLE "generation_traces" DROP COLUMN "retrieval_cost_usd"`);
    await queryRunner.query(`ALTER TABLE "generation_traces" DROP COLUMN "retrieval_ms"`);
    await queryRunner.query(`ALTER TABLE "generation_traces" DROP COLUMN "retrieval_mode"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP CONSTRAINT "bots_retrieval_mode_check"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "retrieval_mode"`);
  }
}
