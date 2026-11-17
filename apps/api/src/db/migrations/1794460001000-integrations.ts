// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Integrations1794460001000 implements MigrationInterface {
  name = 'Integrations1794460001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "integrations" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "provider" text NOT NULL,
        "name" text NOT NULL,
        "status" text NOT NULL DEFAULT 'active',
        "scopes" text[] NOT NULL DEFAULT '{}',
        "external_account_id" text,
        "transcript_sharing" boolean NOT NULL DEFAULT false,
        "last_error" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "disconnected_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "integrations_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "integrations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "integrations_provider_check" CHECK ("provider" IN ('hubspot','salesforce','dynamics365','zoho','pipedrive','zendesk','intercom','freshdesk')),
        CONSTRAINT "integrations_status_check" CHECK ("status" IN ('active','paused','reauth_required','error','disconnected'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "integrations_workspace_id" ON "integrations" ("workspace_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "integration_credentials" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "integration_id" uuid NOT NULL,
        "ciphertext" bytea NOT NULL,
        "iv" bytea NOT NULL,
        "tag" bytea NOT NULL,
        "key_version" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "integration_credentials_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "integration_credentials_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "integration_credentials_workspace_id" ON "integration_credentials" ("workspace_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "integration_credentials_integration_id_key" ON "integration_credentials" ("integration_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "contact_external_links" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "integration_id" uuid NOT NULL,
        "contact_id" uuid NOT NULL,
        "object_type" text NOT NULL,
        "external_object_id" text NOT NULL,
        "idempotency_key" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "contact_external_links_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "contact_external_links_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "contact_external_links_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE,
        CONSTRAINT "contact_external_links_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "contact_external_links_workspace_id" ON "contact_external_links" ("workspace_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "contact_external_links_provider_object_key" ON "contact_external_links" ("integration_id", "object_type", "external_object_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "contact_external_links_idempotency_key" ON "contact_external_links" ("integration_id", "idempotency_key")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."contact_external_links_idempotency_key"`);
    await queryRunner.query(`DROP INDEX "public"."contact_external_links_provider_object_key"`);
    await queryRunner.query(`DROP INDEX "public"."contact_external_links_workspace_id"`);
    await queryRunner.query(`DROP TABLE "contact_external_links"`);
    await queryRunner.query(`DROP INDEX "public"."integration_credentials_integration_id_key"`);
    await queryRunner.query(`DROP INDEX "public"."integration_credentials_workspace_id"`);
    await queryRunner.query(`DROP TABLE "integration_credentials"`);
    await queryRunner.query(`DROP INDEX "public"."integrations_workspace_id"`);
    await queryRunner.query(`DROP TABLE "integrations"`);
  }
}
