// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { TableIndex } from 'typeorm';

/**
 * The built-in `local` credential (Task 2.6). Workspaces created before this migration get the
 * row the `workspace.created` listener now provisions; the partial unique index keeps a repeated
 * delivery from leaving two of them behind.
 */
export class BackfillLocalCredentials1794410000000 implements MigrationInterface {
  name = 'BackfillLocalCredentials1794410000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Re-runnable: the integration test calls `up` again to prove the backfill is idempotent.
    const existing = (await queryRunner.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()
        AND indexname = 'provider_credentials_local'`,
    )) as unknown[];
    if (existing.length === 0) {
      await queryRunner.createIndex(
        'provider_credentials',
        new TableIndex({
          name: 'provider_credentials_local',
          columnNames: ['workspace_id'],
          isUnique: true,
          where: '"provider" = \'local\'',
        }),
      );
    }

    await queryRunner.query(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       SELECT w.id, 'local', 'Built-in (local)'
         FROM workspaces w
        WHERE NOT EXISTS (
          SELECT 1 FROM provider_credentials c
           WHERE c.workspace_id = w.id AND c.provider = 'local'
        )`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM provider_credentials WHERE provider = 'local'`);
    await queryRunner.dropIndex('provider_credentials', 'provider_credentials_local');
  }
}
