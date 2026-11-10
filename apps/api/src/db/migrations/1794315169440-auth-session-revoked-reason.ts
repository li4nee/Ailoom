// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { TableColumn } from 'typeorm';

export class AuthSessionRevokedReason1794315169440 implements MigrationInterface {
  name = 'AuthSessionRevokedReason1794315169440';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'auth_sessions',
      new TableColumn({
        name: 'revoked_reason',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('auth_sessions', 'revoked_reason');
  }
}
