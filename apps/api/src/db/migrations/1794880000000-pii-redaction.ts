// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PiiRedaction1794880000000 implements MigrationInterface {
  name = 'PiiRedaction1794880000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bots" ADD "pii_redaction_categories" text array NOT NULL DEFAULT '{}'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "pii_redaction_categories"`);
  }
}
