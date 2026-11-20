// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentAssistSuggestedReplies1794492000000 implements MigrationInterface {
  name = 'AgentAssistSuggestedReplies1794492000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversation_ai_artifacts" ADD "idempotency_key" text`);
    await queryRunner.query(
      `ALTER TABLE "conversation_ai_artifacts" DROP CONSTRAINT "conversation_ai_artifacts_kind_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_ai_artifacts" ADD CONSTRAINT "conversation_ai_artifacts_kind_check" CHECK ("kind" IN ('handoff_summary', 'suggested_reply'))`,
    );
    await queryRunner.query(`DROP INDEX "conversation_ai_artifacts_one_active_summary"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "conversation_ai_artifacts_one_active" ON "conversation_ai_artifacts" ("workspace_id", "conversation_id", "kind") WHERE "state" IN ('queued', 'running')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "conversation_ai_artifacts_idempotency" ON "conversation_ai_artifacts" ("workspace_id", "conversation_id", "idempotency_key") WHERE "kind" = 'suggested_reply' AND "idempotency_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "conversation_ai_artifacts_user_rate" ON "conversation_ai_artifacts" ("workspace_id", "created_by_user_id", "created_at" DESC) WHERE "kind" = 'suggested_reply'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "conversation_ai_artifacts" WHERE "kind" = 'suggested_reply'`,
    );
    await queryRunner.query(`DROP INDEX "conversation_ai_artifacts_user_rate"`);
    await queryRunner.query(`DROP INDEX "conversation_ai_artifacts_idempotency"`);
    await queryRunner.query(`DROP INDEX "conversation_ai_artifacts_one_active"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "conversation_ai_artifacts_one_active_summary" ON "conversation_ai_artifacts" ("workspace_id", "conversation_id", "kind") WHERE "kind" = 'handoff_summary' AND "state" IN ('queued', 'running')`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_ai_artifacts" DROP CONSTRAINT "conversation_ai_artifacts_kind_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_ai_artifacts" ADD CONSTRAINT "conversation_ai_artifacts_kind_check" CHECK ("kind" IN ('handoff_summary'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_ai_artifacts" DROP COLUMN "idempotency_key"`,
    );
  }
}
