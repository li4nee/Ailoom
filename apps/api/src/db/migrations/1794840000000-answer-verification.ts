// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AnswerVerification1794840000000 implements MigrationInterface {
  name = 'AnswerVerification1794840000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bots" ADD "answer_verification_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD "answer_verification_status" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD "answer_verification_ms" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD CONSTRAINT "generation_traces_answer_verification_status_check" CHECK ("answer_verification_status" IS NULL OR "answer_verification_status" IN ('supported', 'unsupported', 'unavailable', 'invalid_output', 'timeout'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "generation_traces" DROP CONSTRAINT "generation_traces_answer_verification_status_check"`,
    );
    await queryRunner.query(`ALTER TABLE "generation_traces" DROP COLUMN "answer_verification_ms"`);
    await queryRunner.query(
      `ALTER TABLE "generation_traces" DROP COLUMN "answer_verification_status"`,
    );
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "answer_verification_enabled"`);
  }
}
