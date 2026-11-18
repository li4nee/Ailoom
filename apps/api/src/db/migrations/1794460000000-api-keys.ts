// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ApiKeys1794460000000 implements MigrationInterface {
  name = 'ApiKeys1794460000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "api_keys" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "name" text NOT NULL,
        "key_hash" text NOT NULL,
        "key_prefix" text NOT NULL,
        "scopes" text[] NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_used_at" TIMESTAMP WITH TIME ZONE,
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "api_keys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "api_keys_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "api_keys_workspace_key_hash_key" ON "api_keys" ("workspace_id", "key_hash")`,
    );
    await queryRunner.query(`CREATE INDEX "api_keys_workspace_id" ON "api_keys" ("workspace_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."api_keys_workspace_id"`);
    await queryRunner.query(`DROP INDEX "public"."api_keys_workspace_key_hash_key"`);
    await queryRunner.query(`DROP TABLE "api_keys"`);
  }
}
