// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Playground traces (spec §9.5) answer no conversation, so `conversation_id` and
 * `trigger_message_id` must be nullable; they already are on databases created by the core
 * migration, and the DROP NOT NULL keeps a hand-edited schema in line. The platform prompt is
 * versioned in code (spec §13.4) and recorded on every trace so replay shows what the model
 * actually received.
 */
export class TracesPlaygroundNullable1794440000000 implements MigrationInterface {
  name = 'TracesPlaygroundNullable1794440000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "generation_traces"
         ALTER COLUMN "conversation_id" DROP NOT NULL,
         ALTER COLUMN "trigger_message_id" DROP NOT NULL,
         ADD COLUMN "platform_prompt_version" text`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "generation_traces" DROP COLUMN "platform_prompt_version"`,
    );
  }
}
