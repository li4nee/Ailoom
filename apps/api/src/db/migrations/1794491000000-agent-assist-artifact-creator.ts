// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentAssistArtifactCreator1794491000000 implements MigrationInterface {
  name = 'AgentAssistArtifactCreator1794491000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversation_ai_artifacts" ADD "created_by_user_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_ai_artifacts" ADD CONSTRAINT "conversation_ai_artifacts_creator_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversation_ai_artifacts" DROP CONSTRAINT "conversation_ai_artifacts_creator_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_ai_artifacts" DROP COLUMN "created_by_user_id"`,
    );
  }
}
