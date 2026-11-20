// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentAssistSummaries1794490000000 implements MigrationInterface {
  name = 'AgentAssistSummaries1794490000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bots" ADD "automatic_handoff_summaries" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "bots" ADD "suggested_replies_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "bots" ADD "agent_assist_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TYPE "trace_origin" ADD VALUE IF NOT EXISTS 'agent_assist'`);
    await queryRunner.query(`
      CREATE TABLE "conversation_ai_artifacts" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "bot_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "kind" text NOT NULL,
        "state" text NOT NULL,
        "source_through_message_id" uuid,
        "prompt_version" text NOT NULL,
        "trace_id" uuid,
        "content" jsonb,
        "error" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "conversation_ai_artifacts_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "conversation_ai_artifacts_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "conversation_ai_artifacts_bot_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE,
        CONSTRAINT "conversation_ai_artifacts_conversation_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "conversation_ai_artifacts_kind_check" CHECK ("kind" IN ('handoff_summary')),
        CONSTRAINT "conversation_ai_artifacts_state_check" CHECK ("state" IN ('queued', 'running', 'ready', 'failed'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "conversation_ai_artifacts_latest" ON "conversation_ai_artifacts" ("workspace_id", "conversation_id", "kind", "created_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "conversation_ai_artifacts_one_active_summary" ON "conversation_ai_artifacts" ("workspace_id", "conversation_id", "kind") WHERE "kind" = 'handoff_summary' AND "state" IN ('queued', 'running')`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "conversation_ai_artifacts"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "agent_assist_enabled"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "suggested_replies_enabled"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "automatic_handoff_summaries"`);
    // PostgreSQL enum values cannot be removed safely in a rolling deployment.
  }
}
