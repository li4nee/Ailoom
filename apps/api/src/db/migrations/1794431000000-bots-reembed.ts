// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec §12.7. `reembed_generation` lets a running job notice that a newer model change replaced
 * it: it views its own generation, deletes its partial rows and exits without touching the bot.
 * `pending_embedding_credential_id` / `pending_embedding_dim` let ingestion write rows for the
 * target model while the swap has not happened yet.
 */
export class BotsReembed1794431000000 implements MigrationInterface {
  name = 'BotsReembed1794431000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bots"
         ADD COLUMN "reembed_generation" integer NOT NULL DEFAULT 0,
         ADD COLUMN "pending_embedding_credential_id" uuid,
         ADD COLUMN "pending_embedding_dim" integer,
         ADD COLUMN "last_error" text`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bots"
         DROP COLUMN "last_error",
         DROP COLUMN "pending_embedding_dim",
         DROP COLUMN "pending_embedding_credential_id",
         DROP COLUMN "reembed_generation"`,
    );
  }
}
