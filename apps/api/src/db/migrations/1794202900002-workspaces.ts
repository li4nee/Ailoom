// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Table, TableColumn, TableUnique } from 'typeorm';

export class CreateWorkspaces1794202900002 implements MigrationInterface {
  name = 'CreateWorkspaces1794202900002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'workspaces',
        columns: [
          new TableColumn({
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuidv7()',
          }),
          new TableColumn({ name: 'name', type: 'text', isNullable: false }),
          new TableColumn({ name: 'slug', type: 'text', isNullable: false }),
          new TableColumn({ name: 'settings', type: 'jsonb', default: "'{}'" }),
          new TableColumn({ name: 'created_at', type: 'timestamptz', default: 'now()' }),
          new TableColumn({ name: 'updated_at', type: 'timestamptz', default: 'now()' }),
          new TableColumn({ name: 'deleted_at', type: 'timestamptz', isNullable: true }),
        ],
        uniques: [new TableUnique({ name: 'workspaces_slug_key', columnNames: ['slug'] })],
      }),
      true,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('workspaces', true);
  }
}
