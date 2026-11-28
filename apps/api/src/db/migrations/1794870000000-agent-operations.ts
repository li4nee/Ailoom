// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentOperations1794870000000 implements MigrationInterface {
  name = 'AgentOperations1794870000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."notification_type" ADD VALUE 'sla_breached'`);
    await queryRunner.query(
      `ALTER TABLE "workspaces" ADD "agent_operations" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "memberships" ADD "presence_state" text NOT NULL DEFAULT 'offline'`,
    );
    await queryRunner.query(
      `ALTER TABLE "memberships" ADD CONSTRAINT "memberships_presence_state_check" CHECK ("presence_state" IN ('online', 'away', 'offline'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "memberships" ADD "presence_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "first_response_due_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "resolution_due_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "first_response_breached_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "resolution_breached_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "conversations_sla_due_idx" ON "conversations" ("first_response_due_at", "resolution_due_at") WHERE "status" IN ('needs_human', 'human') AND "closed_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "memberships_presence_idx" ON "memberships" ("workspace_id", "presence_state", "presence_expires_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "notifications" WHERE "type" = 'sla_breached'`);
    await queryRunner.query(`DROP INDEX "memberships_presence_idx"`);
    await queryRunner.query(`DROP INDEX "conversations_sla_due_idx"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "resolution_breached_at"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "first_response_breached_at"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "resolution_due_at"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "first_response_due_at"`);
    await queryRunner.query(
      `ALTER TABLE "memberships" DROP CONSTRAINT "memberships_presence_state_check"`,
    );
    await queryRunner.query(`ALTER TABLE "memberships" DROP COLUMN "presence_expires_at"`);
    await queryRunner.query(`ALTER TABLE "memberships" DROP COLUMN "presence_state"`);
    await queryRunner.query(`ALTER TABLE "workspaces" DROP COLUMN "agent_operations"`);
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type" RENAME TO "notification_type_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notification_type" AS ENUM('handoff_requested', 'conversation_assigned', 'visitor_replied', 'spend_alert', 'suggestion_created', 'suggestion_reviewed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notification_type" USING "type"::text::"public"."notification_type"`,
    );
    await queryRunner.query(`DROP TYPE "public"."notification_type_old"`);
  }
}
