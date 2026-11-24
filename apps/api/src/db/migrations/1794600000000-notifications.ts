// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Notifications1794600000000 implements MigrationInterface {
  name = 'Notifications1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."notification_type" AS ENUM('handoff_requested', 'conversation_assigned', 'visitor_replied', 'spend_alert', 'suggestion_created', 'suggestion_reviewed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "memberships" ADD "notification_preferences" jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuidv7(), "workspace_id" uuid NOT NULL, "user_id" uuid NOT NULL, "type" "public"."notification_type" NOT NULL, "payload" jsonb NOT NULL, "dedupe_key" text, "read_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_notifications" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "notifications_membership_fkey" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "memberships"("workspace_id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "notifications_inbox_idx" ON "notifications" ("workspace_id", "user_id", "read_at", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "notifications_unread_dedupe_idx" ON "notifications" ("workspace_id", "user_id", "dedupe_key") WHERE "read_at" IS NULL AND "dedupe_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."notifications_unread_dedupe_idx"`);
    await queryRunner.query(`DROP INDEX "public"."notifications_inbox_idx"`);
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "notifications_membership_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "notifications_workspace_fkey"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`ALTER TABLE "memberships" DROP COLUMN "notification_preferences"`);
    await queryRunner.query(`DROP TYPE "public"."notification_type"`);
  }
}
