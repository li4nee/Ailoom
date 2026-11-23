// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IntegrationOAuthState1794530000000 implements MigrationInterface {
  name = 'IntegrationOAuthState1794530000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "integration_oauth_states" (
        "state_hash" char(64) NOT NULL,
        "workspace_id" uuid NOT NULL,
        "actor_user_id" uuid NOT NULL,
        "provider" text NOT NULL,
        "name" text NOT NULL,
        "base_url" text,
        "scopes" text[] NOT NULL DEFAULT '{}',
        "return_url" text NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_2e45a99313bf7c48d3d7c66b50e" PRIMARY KEY ("state_hash"),
        CONSTRAINT "integration_oauth_states_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "integration_oauth_states_workspace_id" ON "integration_oauth_states" ("workspace_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."integration_oauth_states_workspace_id"`);
    await queryRunner.query(`DROP TABLE "integration_oauth_states"`);
  }
}
