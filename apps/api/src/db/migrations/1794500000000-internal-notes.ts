// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InternalNotes1794500000000 implements MigrationInterface {
  name = 'InternalNotes1794500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "conversation_internal_notes" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "author_user_id" uuid,
        "body" text,
        "version" integer NOT NULL DEFAULT 1,
        "deleted_at" timestamptz,
        "deleted_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "conversation_internal_notes_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "conversation_internal_notes_body_length" CHECK ("body" IS NULL OR char_length("body") <= 4000),
        CONSTRAINT "conversation_internal_notes_version_check" CHECK ("version" >= 1),
        CONSTRAINT "conversation_internal_notes_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "conversation_internal_notes_conversation_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "conversation_internal_notes_author_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "conversation_internal_notes_deleted_by_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "conversation_internal_notes_timeline" ON "conversation_internal_notes" ("workspace_id", "conversation_id", "created_at", "id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "conversation_internal_notes_timeline"`);
    await queryRunner.query(`DROP TABLE "conversation_internal_notes"`);
  }
}
