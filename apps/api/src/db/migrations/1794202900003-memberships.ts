// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

import { ROLES } from '@app/shared';

export class CreateMemberships1794202900003 implements MigrationInterface {
  name = 'CreateMemberships1794202900003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'memberships',
        columns: [
          new TableColumn({ name: 'workspace_id', type: 'uuid', isPrimary: true }),
          new TableColumn({ name: 'user_id', type: 'uuid', isPrimary: true }),
          new TableColumn({
            name: 'role',
            type: 'enum',
            enum: [...ROLES],
            enumName: 'role',
          }),
          new TableColumn({ name: 'created_at', type: 'timestamptz', default: 'now()' }),
        ],
        indices: [
          new TableIndex({
            name: 'memberships_one_owner',
            columnNames: ['workspace_id'],
            isUnique: true,
            where: `"role" = 'owner'`,
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'memberships_workspace_id_fkey',
            columnNames: ['workspace_id'],
            referencedTableName: 'workspaces',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
          new TableForeignKey({
            name: 'memberships_user_id_fkey',
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
    await queryRunner.dropTable('memberships', true);
  }
}
