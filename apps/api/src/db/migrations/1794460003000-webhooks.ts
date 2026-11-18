// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Webhooks1794460003000 implements MigrationInterface {
  name = 'Webhooks1794460003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "webhooks" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "url" text NOT NULL,
        "events" text[] NOT NULL,
        "status" text NOT NULL DEFAULT 'active',
        "secret_ciphertext" bytea NOT NULL,
        "secret_iv" bytea NOT NULL,
        "secret_tag" bytea NOT NULL,
        "key_version" integer NOT NULL,
        "last_error" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "webhooks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "webhooks_status_check" CHECK ("status" IN ('active','paused'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "webhooks_workspace_id" ON "webhooks" ("workspace_id")`);

    await queryRunner.query(`
      CREATE TABLE "webhook_deliveries" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "webhook_id" uuid NOT NULL,
        "event_id" uuid NOT NULL,
        "event_type" text NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "status_code" integer,
        "duration_ms" integer,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "next_attempt_at" TIMESTAMP WITH TIME ZONE,
        "delivered_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "webhook_deliveries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE,
        CONSTRAINT "webhook_deliveries_status_check" CHECK ("status" IN ('pending','retrying','delivered','failed','skipped')),
        CONSTRAINT "webhook_deliveries_event_type_check" CHECK ("event_type" IN ('contact.created','contact.updated','conversation.created','conversation.updated','message.created','handoff.requested','conversation.closed','feedback.created'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "webhook_deliveries_workspace_id" ON "webhook_deliveries" ("workspace_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "webhook_deliveries_webhook_event_key" ON "webhook_deliveries" ("webhook_id", "event_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."webhook_deliveries_webhook_event_key"`);
    await queryRunner.query(`DROP INDEX "public"."webhook_deliveries_workspace_id"`);
    await queryRunner.query(`DROP TABLE "webhook_deliveries"`);
    await queryRunner.query(`DROP INDEX "public"."webhooks_workspace_id"`);
    await queryRunner.query(`DROP TABLE "webhooks"`);
  }
}
