// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BotTools1794630000000 implements MigrationInterface {
  name = 'BotTools1794630000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "bots_id_workspace_id_key" ON "bots" ("id", "workspace_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "bot_tools" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "bot_id" uuid NOT NULL,
        "name" text NOT NULL,
        "definition" jsonb NOT NULL,
        "tested_definition_hash" text,
        "tested_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "bot_tools_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "bot_tools_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "bot_tools_bot_workspace_fkey" FOREIGN KEY ("bot_id", "workspace_id") REFERENCES "bots"("id", "workspace_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "bot_tools_bot_name_key" ON "bot_tools" ("workspace_id", "bot_id", "name")
    `);
    await queryRunner.query(
      `CREATE INDEX "bot_tools_workspace_bot_idx" ON "bot_tools" ("workspace_id", "bot_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "tool_invocations" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "bot_id" uuid NOT NULL,
        "tool_id" uuid NOT NULL,
        "conversation_id" uuid,
        "turn_id" uuid NOT NULL,
        "trace_id" uuid,
        "name" text NOT NULL,
        "input_fields" jsonb NOT NULL DEFAULT '[]',
        "output_fields" jsonb NOT NULL DEFAULT '[]',
        "status" text NOT NULL DEFAULT 'started',
        "error_code" text,
        "duration_ms" integer,
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "tool_invocations_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "tool_invocations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "tool_invocations_bot_workspace_fkey" FOREIGN KEY ("bot_id", "workspace_id") REFERENCES "bots"("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "tool_invocations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL,
        CONSTRAINT "tool_invocations_trace_id_fkey" FOREIGN KEY ("trace_id") REFERENCES "generation_traces"("id") ON DELETE SET NULL,
        CONSTRAINT "tool_invocations_status_check" CHECK ("status" IN ('started', 'complete', 'failed')),
        CONSTRAINT "tool_invocations_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "tool_invocations_workspace_turn_idx" ON "tool_invocations" ("workspace_id", "turn_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "tool_invocations_workspace_trace_idx" ON "tool_invocations" ("workspace_id", "trace_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tool_invocations"`);
    await queryRunner.query(`DROP TABLE "bot_tools"`);
    await queryRunner.query(`DROP INDEX "public"."bots_id_workspace_id_key"`);
  }
}
