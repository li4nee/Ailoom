// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BotsFallbackModel1794550000000 implements MigrationInterface {
  name = 'BotsFallbackModel1794550000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bots" ADD "fallback_chat_credential_id" uuid`);
    await queryRunner.query(`ALTER TABLE "bots" ADD "fallback_chat_model" text`);
    await queryRunner.query(
      `ALTER TABLE "bots" ADD CONSTRAINT "bots_fallback_chat_credential_id_fkey"
       FOREIGN KEY ("fallback_chat_credential_id") REFERENCES "provider_credentials"("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "bots" ADD CONSTRAINT "bots_fallback_chat_pair_check"
       CHECK (("fallback_chat_credential_id" IS NULL) = ("fallback_chat_model" IS NULL))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bots" DROP CONSTRAINT "bots_fallback_chat_pair_check"`);
    await queryRunner.query(
      `ALTER TABLE "bots" DROP CONSTRAINT "bots_fallback_chat_credential_id_fkey"`,
    );
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "fallback_chat_model"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "fallback_chat_credential_id"`);
  }
}
