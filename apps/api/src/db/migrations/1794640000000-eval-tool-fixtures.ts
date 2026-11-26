// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EvalToolFixtures1794640000000 implements MigrationInterface {
  name = 'EvalToolFixtures1794640000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "eval_cases" ADD "tool_fixtures" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "eval_cases" DROP COLUMN "tool_fixtures"`);
  }
}
