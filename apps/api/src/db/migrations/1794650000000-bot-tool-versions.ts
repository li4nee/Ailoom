// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BotToolVersions1794650000000 implements MigrationInterface {
  name = 'BotToolVersions1794650000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bot_tools" ADD "version" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(
      `ALTER TABLE "tool_invocations" ADD "tool_version" integer NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `CREATE INDEX "tool_invocations_created_at_idx" ON "tool_invocations" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "bot_tools_id_workspace_bot_key" ON "bot_tools" ("id", "workspace_id", "bot_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "bot_tool_versions" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "workspace_id" uuid NOT NULL,
        "bot_id" uuid NOT NULL,
        "tool_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "definition" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "bot_tool_versions_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "bot_tool_versions_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        CONSTRAINT "bot_tool_versions_bot_workspace_fkey" FOREIGN KEY ("bot_id", "workspace_id") REFERENCES "bots"("id", "workspace_id") ON DELETE CASCADE,
        CONSTRAINT "bot_tool_versions_tool_workspace_bot_fkey" FOREIGN KEY ("tool_id", "workspace_id", "bot_id") REFERENCES "bot_tools"("id", "workspace_id", "bot_id") ON DELETE CASCADE,
        CONSTRAINT "bot_tool_versions_version_check" CHECK ("version" > 0),
        CONSTRAINT "bot_tool_versions_workspace_tool_version_key" UNIQUE ("workspace_id", "tool_id", "version")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "bot_tool_versions" ("workspace_id", "bot_id", "tool_id", "version", "definition")
      SELECT "workspace_id", "bot_id", "id", "version", "definition" FROM "bot_tools"
    `);
    await queryRunner.query(`
      CREATE FUNCTION "reject_bot_tool_version_update"() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'bot tool versions are immutable';
      END; $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "bot_tool_versions_immutable"
      BEFORE UPDATE ON "bot_tool_versions"
      FOR EACH ROW EXECUTE FUNCTION "reject_bot_tool_version_update"()
    `);
    await queryRunner.query(`
      CREATE TABLE "bot_tool_auth_secrets" (
        "workspace_id" uuid NOT NULL,
        "tool_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "header_name" text NOT NULL,
        "ciphertext" bytea NOT NULL,
        "iv" bytea NOT NULL,
        "tag" bytea NOT NULL,
        "key_version" integer NOT NULL,
        CONSTRAINT "bot_tool_auth_secrets_pkey" PRIMARY KEY ("workspace_id", "tool_id", "version"),
        CONSTRAINT "bot_tool_auth_secrets_version_fkey" FOREIGN KEY ("workspace_id", "tool_id", "version") REFERENCES "bot_tool_versions"("workspace_id", "tool_id", "version") ON DELETE CASCADE,
        CONSTRAINT "bot_tool_auth_secrets_key_version_check" CHECK ("key_version" > 0)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "bot_tool_auth_secrets"`);
    await queryRunner.query(`DROP TRIGGER "bot_tool_versions_immutable" ON "bot_tool_versions"`);
    await queryRunner.query(`DROP FUNCTION "reject_bot_tool_version_update"()`);
    await queryRunner.query(`DROP TABLE "bot_tool_versions"`);
    await queryRunner.query(`DROP INDEX "bot_tools_id_workspace_bot_key"`);
    await queryRunner.query(`DROP INDEX "tool_invocations_created_at_idx"`);
    await queryRunner.query(`ALTER TABLE "tool_invocations" DROP COLUMN "tool_version"`);
    await queryRunner.query(`ALTER TABLE "bot_tools" DROP COLUMN "version"`);
  }
}
