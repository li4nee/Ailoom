// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Table, TableColumn, TableForeignKey } from 'typeorm';

export class CreateInstanceSettings1794202900009 implements MigrationInterface {
  name = 'CreateInstanceSettings1794202900009';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'instance_settings',
        columns: [
          new TableColumn({ name: 'key', type: 'text', isPrimary: true }),
          new TableColumn({ name: 'value', type: 'jsonb' }),
          new TableColumn({ name: 'updated_by', type: 'uuid', isNullable: true }),
          new TableColumn({ name: 'updated_at', type: 'timestamptz', default: 'now()' }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'instance_settings_updated_by_fkey',
            columnNames: ['updated_by'],
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
    await queryRunner.dropTable('instance_settings', true);
  }
}
