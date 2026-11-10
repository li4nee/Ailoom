// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class CreateEmailTokens1794202900006 implements MigrationInterface {
  name = 'CreateEmailTokens1794202900006';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'email_tokens',
        columns: [
          new TableColumn({
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuidv7()',
          }),
          new TableColumn({ name: 'user_id', type: 'uuid', isNullable: true }),
          new TableColumn({
            name: 'type',
            type: 'enum',
            // Frozen literal values: a migration must never change when shared enums change later.
            enum: ['verify_email', 'reset_password'],
            enumName: 'email_token_type',
          }),
          new TableColumn({ name: 'token_hash', type: 'text' }),
          new TableColumn({ name: 'expires_at', type: 'timestamptz' }),
          new TableColumn({ name: 'used_at', type: 'timestamptz', isNullable: true }),
        ],
        indices: [
          new TableIndex({
            name: 'email_tokens_token_hash_key',
            columnNames: ['token_hash'],
            isUnique: true,
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'email_tokens_user_id_fkey',
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
    await queryRunner.dropTable('email_tokens', true);
  }
}
