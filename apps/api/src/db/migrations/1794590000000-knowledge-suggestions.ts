// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class KnowledgeSuggestions1794590000000 implements MigrationInterface {
  name = 'KnowledgeSuggestions1794590000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "suggestion_status" AS ENUM ('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "knowledge_suggestions" (
         "id" uuid NOT NULL DEFAULT uuidv7(),
         "workspace_id" uuid NOT NULL,
         "bot_id" uuid NOT NULL,
         "message_id" uuid,
         "conversation_id" uuid,
         "question" text NOT NULL,
         "answer" text NOT NULL,
         "status" "suggestion_status" NOT NULL DEFAULT 'pending',
         "created_by" uuid,
         "reviewed_by" uuid,
         "reviewed_at" timestamptz,
         "reject_reason" text,
         "source_id" uuid,
         "created_at" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "knowledge_suggestions_pk" PRIMARY KEY ("id"),
         CONSTRAINT "knowledge_suggestions_workspace_fkey"
           FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
         CONSTRAINT "knowledge_suggestions_bot_fkey"
           FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE,
         CONSTRAINT "knowledge_suggestions_message_fkey"
           FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL,
         CONSTRAINT "knowledge_suggestions_conversation_fkey"
           FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL,
         CONSTRAINT "knowledge_suggestions_created_by_fkey"
           FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL,
         CONSTRAINT "knowledge_suggestions_reviewed_by_fkey"
           FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL,
         CONSTRAINT "knowledge_suggestions_source_fkey"
           FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE SET NULL,
         CONSTRAINT "knowledge_suggestions_reject_reason_check"
           CHECK ("reject_reason" IS NULL OR char_length("reject_reason") <= 500)
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "knowledge_suggestions_workspace_status_created"
         ON "knowledge_suggestions" ("workspace_id", "status", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "knowledge_suggestions_workspace_bot_status_created"
         ON "knowledge_suggestions" ("workspace_id", "bot_id", "status", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "knowledge_suggestions_one_pending_per_message"
         ON "knowledge_suggestions" ("workspace_id", "message_id")
         WHERE "status" = 'pending' AND "message_id" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "knowledge_suggestions_one_pending_per_message"`);
    await queryRunner.query(`DROP INDEX "knowledge_suggestions_workspace_bot_status_created"`);
    await queryRunner.query(`DROP INDEX "knowledge_suggestions_workspace_status_created"`);
    await queryRunner.query(`DROP TABLE "knowledge_suggestions"`);
    await queryRunner.query(`DROP TYPE "suggestion_status"`);
  }
}
