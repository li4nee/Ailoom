// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationCsat1794560000000 implements MigrationInterface {
  name = 'ConversationCsat1794560000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bots" ADD "csat_enabled" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "conversations" ADD "csat_score" smallint`);
    await queryRunner.query(`ALTER TABLE "conversations" ADD "csat_comment" text`);
    await queryRunner.query(`ALTER TABLE "conversations" ADD "csat_at" timestamptz`);
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "conversations_csat_score_check"
       CHECK ("csat_score" IS NULL OR "csat_score" BETWEEN 1 AND 5)`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "conversations_csat_comment_length_check"
       CHECK ("csat_comment" IS NULL OR char_length("csat_comment") <= 1000)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "conversations_csat_comment_length_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "conversations_csat_score_check"`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "csat_at"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "csat_comment"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "csat_score"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "csat_enabled"`);
  }
}
