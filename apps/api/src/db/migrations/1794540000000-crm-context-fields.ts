// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CrmContextFields1794540000000 implements MigrationInterface {
  name = 'CrmContextFields1794540000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integrations" ADD "crm_context_fields" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "integration_oauth_states" ADD "crm_context_fields" jsonb`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integrations" DROP COLUMN "crm_context_fields"`);
    await queryRunner.query(
      `ALTER TABLE "integration_oauth_states" DROP COLUMN "crm_context_fields"`,
    );
  }
}
