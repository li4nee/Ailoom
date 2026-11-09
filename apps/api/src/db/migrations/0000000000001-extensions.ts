// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

// TypeORM reads the migration time from the last 13 digits of the class name and rejects 0,
// so the first migration is 1 (still ahead of every real, millisecond-timestamped migration).
/**
 * pgvector for embeddings and citext for case-insensitive text such as email addresses.
 * uuidv7() needs no extension: PostgreSQL 18 ships it.
 */
export class Extensions0000000000001 implements MigrationInterface {
  name = 'Extensions0000000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS vector');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS citext');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP EXTENSION IF EXISTS citext');
    await queryRunner.query('DROP EXTENSION IF EXISTS vector');
  }
}
