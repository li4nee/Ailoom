// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class CreateAuthSessions1794202900005 implements MigrationInterface {
  name = 'CreateAuthSessions1794202900005';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'auth_sessions',
        columns: [
          new TableColumn({
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuidv7()',
          }),
          new TableColumn({ name: 'user_id', type: 'uuid' }),
          new TableColumn({ name: 'refresh_token_hash', type: 'text' }),
          new TableColumn({ name: 'family_id', type: 'uuid' }),
          new TableColumn({ name: 'user_agent', type: 'text', isNullable: true }),
          new TableColumn({ name: 'ip', type: 'text', isNullable: true }),
          new TableColumn({ name: 'last_used_at', type: 'timestamptz', isNullable: true }),
          new TableColumn({ name: 'expires_at', type: 'timestamptz' }),
          new TableColumn({ name: 'revoked_at', type: 'timestamptz', isNullable: true }),
          new TableColumn({ name: 'created_at', type: 'timestamptz', default: 'now()' }),
        ],
        indices: [
          new TableIndex({
            name: 'auth_sessions_user_active',
            columnNames: ['user_id'],
            where: '"revoked_at" IS NULL',
          }),
          new TableIndex({
            name: 'auth_sessions_refresh_token_hash_key',
            columnNames: ['refresh_token_hash'],
            isUnique: true,
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'auth_sessions_user_id_fkey',
            columnNames: ['user_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
        ],
      }),
      true,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('auth_sessions', true);
  }
}
