// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationWorkflowVersion1794470000000 implements MigrationInterface {
  name = 'ConversationWorkflowVersion1794470000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "workflow_version" integer NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" ADD "last_workflow_mutation_id" uuid`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "last_workflow_mutation_id"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "workflow_version"`);
  }
}
