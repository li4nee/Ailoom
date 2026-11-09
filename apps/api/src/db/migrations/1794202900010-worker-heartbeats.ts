// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Table, TableColumn } from 'typeorm';

export class CreateWorkerHeartbeats1794202900010 implements MigrationInterface {
  name = 'CreateWorkerHeartbeats1794202900010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'worker_heartbeats',
        columns: [
          new TableColumn({ name: 'worker_id', type: 'text', isPrimary: true }),
          new TableColumn({ name: 'last_beat_at', type: 'timestamptz', default: 'now()' }),
          new TableColumn({ name: 'version', type: 'text', isNullable: true }),
        ],
      }),
      true,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('worker_heartbeats', true);
  }
}
