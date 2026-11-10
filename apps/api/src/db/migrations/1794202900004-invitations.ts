// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class CreateInvitations1794202900004 implements MigrationInterface {
  name = 'CreateInvitations1794202900004';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'invitations',
        columns: [
          new TableColumn({
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuidv7()',
          }),
          new TableColumn({ name: 'workspace_id', type: 'uuid' }),
          new TableColumn({ name: 'email', type: 'citext' }),
          new TableColumn({
            name: 'role',
            type: 'enum',
            // Frozen literal values: a migration must never change when shared enums change later.
            enum: ['admin', 'agent'],
            enumName: 'invitation_role',
          }),
          new TableColumn({ name: 'token_hash', type: 'text' }),
          new TableColumn({ name: 'invited_by', type: 'uuid' }),
          new TableColumn({ name: 'expires_at', type: 'timestamptz' }),
          new TableColumn({ name: 'accepted_at', type: 'timestamptz', isNullable: true }),
        ],
        indices: [
          new TableIndex({ name: 'invitations_workspace_id', columnNames: ['workspace_id'] }),
          new TableIndex({
            name: 'invitations_token_hash_key',
            columnNames: ['token_hash'],
            isUnique: true,
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'invitations_workspace_id_fkey',
            columnNames: ['workspace_id'],
            referencedTableName: 'workspaces',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
          new TableForeignKey({
            name: 'invitations_invited_by_fkey',
            columnNames: ['invited_by'],
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
    await queryRunner.dropTable('invitations', true);
  }
}
