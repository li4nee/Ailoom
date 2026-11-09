// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class CreateAuditLog1794202900007 implements MigrationInterface {
  name = 'CreateAuditLog1794202900007';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'audit_log',
        columns: [
          new TableColumn({
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuidv7()',
          }),
          new TableColumn({ name: 'workspace_id', type: 'uuid', isNullable: true }),
          new TableColumn({ name: 'actor_user_id', type: 'uuid', isNullable: true }),
          new TableColumn({ name: 'action', type: 'text' }),
          new TableColumn({ name: 'target_type', type: 'text', isNullable: true }),
          new TableColumn({ name: 'target_id', type: 'uuid', isNullable: true }),
          new TableColumn({ name: 'metadata', type: 'jsonb', default: "'{}'" }),
          new TableColumn({ name: 'ip', type: 'inet', isNullable: true }),
          new TableColumn({ name: 'created_at', type: 'timestamptz', default: 'now()' }),
        ],
        indices: [
          new TableIndex({ name: 'audit_log_workspace_id', columnNames: ['workspace_id'] }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'audit_log_workspace_id_fkey',
            columnNames: ['workspace_id'],
            referencedTableName: 'workspaces',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          }),
          new TableForeignKey({
            name: 'audit_log_actor_user_id_fkey',
            columnNames: ['actor_user_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          }),
        ],
      }),
      true,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('audit_log', true);
  }
}
