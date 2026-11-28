// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WidgetInteractions1794860000000 implements MigrationInterface {
  name = 'WidgetInteractions1794860000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bots" ADD "widget_interactions" jsonb NOT NULL DEFAULT '{"cards":[],"quickReplies":[],"form":null}'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "widget_interactions"`);
  }
}
