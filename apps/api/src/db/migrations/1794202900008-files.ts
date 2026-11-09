// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class CreateFiles1794202900008 implements MigrationInterface {
  name = 'CreateFiles1794202900008';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'files',
        columns: [
          new TableColumn({
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuidv7()',
          }),
          new TableColumn({ name: 'workspace_id', type: 'uuid' }),
          new TableColumn({ name: 'storage_key', type: 'text' }),
          new TableColumn({ name: 'filename', type: 'text' }),
          new TableColumn({ name: 'mime_type', type: 'text' }),
          new TableColumn({ name: 'size_bytes', type: 'bigint' }),
          new TableColumn({ name: 'sha256', type: 'text' }),
          new TableColumn({ name: 'created_at', type: 'timestamptz', default: 'now()' }),
        ],
        indices: [new TableIndex({ name: 'files_workspace_id', columnNames: ['workspace_id'] })],
        foreignKeys: [
          new TableForeignKey({
            name: 'files_workspace_id_fkey',
            columnNames: ['workspace_id'],
            referencedTableName: 'workspaces',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
        ],
      }),
      true,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('files', true);
  }
}
