// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SavedReplies1794480000000 implements MigrationInterface {
  name = 'SavedReplies1794480000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "saved_replies" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "title" text NOT NULL,
        "body" text NOT NULL,
        "normalized_title" text NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "archived_at" TIMESTAMPTZ,
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_55af264beda24a4a6daa7f35fe9" PRIMARY KEY ("id"),
        CONSTRAINT "saved_replies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "saved_replies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "saved_replies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "saved_replies_workspace_order" ON "saved_replies" ("workspace_id", "archived_at", "sort_order", "normalized_title", "id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "saved_replies_workspace_active_title" ON "saved_replies" ("workspace_id", "normalized_title") WHERE "archived_at" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "saved_replies"`);
  }
}
