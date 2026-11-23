// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IntegrationDeliveries1794520000000 implements MigrationInterface {
  name = 'IntegrationDeliveries1794520000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "integration_deliveries" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "integration_id" uuid NOT NULL,
        "event_id" uuid NOT NULL,
        "event_type" text NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "status_code" integer,
        "duration_ms" integer,
        "last_error" text,
        "external_object_type" text,
        "external_object_id" text,
        "delivered_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "integration_deliveries_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "integration_deliveries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "integration_deliveries_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE,
        CONSTRAINT "integration_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "integration_events"("id") ON DELETE CASCADE,
        CONSTRAINT "integration_deliveries_status_check" CHECK ("status" IN ('pending','sending','retrying','delivered','failed','skipped')),
        CONSTRAINT "integration_deliveries_event_type_check" CHECK ("event_type" IN ('contact.created','contact.updated','conversation.created','conversation.updated','message.created','handoff.requested','conversation.closed','feedback.created'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "integration_deliveries_workspace_id" ON "integration_deliveries" ("workspace_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "integration_deliveries_integration_created" ON "integration_deliveries" ("integration_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "integration_deliveries_integration_event" ON "integration_deliveries" ("integration_id", "event_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."integration_deliveries_integration_event"`);
    await queryRunner.query(`DROP INDEX "public"."integration_deliveries_integration_created"`);
    await queryRunner.query(`DROP INDEX "public"."integration_deliveries_workspace_id"`);
    await queryRunner.query(`DROP TABLE "integration_deliveries"`);
  }
}
