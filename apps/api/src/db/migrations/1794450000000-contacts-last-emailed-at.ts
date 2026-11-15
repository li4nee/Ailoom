// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Debounced agent-reply email (spec §9.4): the timestamp of the newest agent message included
 * in the last email, so a later job only sends messages the visitor has not already received.
 */
export class ContactsLastEmailedAt1794450000000 implements MigrationInterface {
  name = 'ContactsLastEmailedAt1794450000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contacts" ADD COLUMN "last_emailed_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contacts" DROP COLUMN "last_emailed_at"`);
  }
}
