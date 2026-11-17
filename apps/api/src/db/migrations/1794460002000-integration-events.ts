// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IntegrationEvents1794460002000 implements MigrationInterface {
  name = 'IntegrationEvents1794460002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "integration_events" (
        "id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "type" text NOT NULL,
        "aggregate_id" uuid NOT NULL,
        "idempotency_key" text NOT NULL,
        "data" jsonb NOT NULL,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "attempts" integer NOT NULL DEFAULT 0,
        "leased_until" TIMESTAMP WITH TIME ZONE,
        "lease_owner" text,
        "dispatched_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "integration_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "integration_events_type_check" CHECK ("type" IN ('contact.created','contact.updated','conversation.created','conversation.updated','message.created','handoff.requested','conversation.closed','feedback.created'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "integration_events_workspace_id" ON "integration_events" ("workspace_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "integration_events_workspace_idempotency_key" ON "integration_events" ("workspace_id", "idempotency_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "integration_events_dispatch_order" ON "integration_events" ("dispatched_at", "leased_until", "occurred_at", "id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."integration_events_dispatch_order"`);
    await queryRunner.query(`DROP INDEX "public"."integration_events_workspace_idempotency_key"`);
    await queryRunner.query(`DROP INDEX "public"."integration_events_workspace_id"`);
    await queryRunner.query(`DROP TABLE "integration_events"`);
  }
}
