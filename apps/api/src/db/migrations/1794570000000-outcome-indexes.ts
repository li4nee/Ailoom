// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Cover the bounded population and its message/trace aggregates used by OutcomesRepository. */
export class OutcomeIndexes1794570000000 implements MigrationInterface {
  name = 'OutcomeIndexes1794570000000';
  transaction = false as const;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_outcomes_range"
       ON "conversations" ("workspace_id", "created_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "conversations_outcomes_range"`);
  }
}
