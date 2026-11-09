// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Table, TableColumn, TableUnique } from 'typeorm';

export class CreateUsers1794202900001 implements MigrationInterface {
  name = 'CreateUsers1794202900001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          new TableColumn({
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuidv7()',
          }),
          new TableColumn({ name: 'email', type: 'citext', isNullable: false }),
          new TableColumn({ name: 'password_hash', type: 'text', isNullable: false }),
          new TableColumn({ name: 'name', type: 'text', isNullable: true }),
          new TableColumn({ name: 'email_verified_at', type: 'timestamptz', isNullable: true }),
          new TableColumn({ name: 'is_instance_admin', type: 'boolean', default: false }),
          new TableColumn({ name: 'token_version', type: 'int', default: 0 }),
          new TableColumn({ name: 'created_at', type: 'timestamptz', default: 'now()' }),
          new TableColumn({ name: 'updated_at', type: 'timestamptz', default: 'now()' }),
        ],
        uniques: [new TableUnique({ name: 'users_email_key', columnNames: ['email'] })],
      }),
      true,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('users', true);
  }
}
