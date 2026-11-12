// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-bot generation settings (Task 2.8). Stored on the bot rather than read from config: an
 * operator tunes one bot without redeploying, and the values existing bots behave with today
 * become their explicit defaults.
 */
export class BotsGenerationSettings1794420000000 implements MigrationInterface {
  name = 'BotsGenerationSettings1794420000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Quoted, to match the entity's default exactly: `db:check` compares the expression text.
    await queryRunner.query(`ALTER TABLE "bots" ADD "temperature" real NOT NULL DEFAULT '0.2'`);
    await queryRunner.query(
      `ALTER TABLE "bots" ADD "max_output_tokens" integer NOT NULL DEFAULT 600`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "max_output_tokens"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "temperature"`);
  }
}
