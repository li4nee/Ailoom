// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationInboxPriorityIndex1794510000000 implements MigrationInterface {
  name = 'ConversationInboxPriorityIndex1794510000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "conversations_inbox_priority"
         ON "conversations" (
           "workspace_id",
           (CASE WHEN "status" = 'needs_human' THEN 0 ELSE 1 END),
           "priority" DESC,
           "last_message_at" DESC,
           "id" DESC
         )`,
    );
    await queryRunner.query(
      `CREATE INDEX "conversations_inbox_priority_status"
         ON "conversations" (
           "workspace_id",
           "status",
           "priority" DESC,
           "last_message_at" DESC,
           "id" DESC
         )`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "conversations_inbox_priority_status"`);
    await queryRunner.query(`DROP INDEX "conversations_inbox_priority"`);
  }
}
