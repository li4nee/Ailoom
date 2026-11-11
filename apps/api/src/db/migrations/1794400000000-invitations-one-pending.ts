// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { TableIndex } from 'typeorm';

/** One pending invitation per (workspace, email): re-inviting replaces the row's token. */
export class InvitationsOnePending1794400000000 implements MigrationInterface {
  name = 'InvitationsOnePending1794400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createIndex(
      'invitations',
      new TableIndex({
        name: 'invitations_one_pending',
        columnNames: ['workspace_id', 'email'],
        isUnique: true,
        where: '"accepted_at" IS NULL',
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('invitations', 'invitations_one_pending');
  }
}
