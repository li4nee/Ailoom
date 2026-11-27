// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ModelRoutingSpendControls1794850000000 implements MigrationInterface {
  name = 'ModelRoutingSpendControls1794850000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bots" ADD "economy_chat_credential_id" uuid`);
    await queryRunner.query(`ALTER TABLE "bots" ADD "economy_chat_model" text`);
    await queryRunner.query(
      `ALTER TABLE "bots" ADD CONSTRAINT "bots_economy_chat_pair_check" CHECK (("economy_chat_credential_id" IS NULL) = ("economy_chat_model" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "bots" ADD CONSTRAINT "bots_economy_chat_credential_id_fkey" FOREIGN KEY ("economy_chat_credential_id") REFERENCES "provider_credentials"("id") ON DELETE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "bots" ADD "daily_spend_cap_usd" numeric(10,2)`);
    await queryRunner.query(
      `ALTER TABLE "bots" ADD CONSTRAINT "bots_daily_spend_cap_check" CHECK ("daily_spend_cap_usd" IS NULL OR "daily_spend_cap_usd" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD "model_routing_reason" text NOT NULL DEFAULT 'primary'`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ADD CONSTRAINT "generation_traces_model_routing_reason_check" CHECK ("model_routing_reason" IN ('primary', 'simple_question'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "generation_traces" DROP CONSTRAINT "generation_traces_model_routing_reason_check"`,
    );
    await queryRunner.query(`ALTER TABLE "generation_traces" DROP COLUMN "model_routing_reason"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP CONSTRAINT "bots_daily_spend_cap_check"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "daily_spend_cap_usd"`);
    await queryRunner.query(
      `ALTER TABLE "bots" DROP CONSTRAINT "bots_economy_chat_credential_id_fkey"`,
    );
    await queryRunner.query(`ALTER TABLE "bots" DROP CONSTRAINT "bots_economy_chat_pair_check"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "economy_chat_model"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "economy_chat_credential_id"`);
  }
}
