// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, Not } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { ConversationEntity } from './entities/conversation.entity';

/** Conversations of one workspace. Every write is workspace-scoped. */
@Injectable()
export class ConversationsRepository extends TenantRepository<ConversationEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(ConversationEntity));
  }

  /**
   * The conversation a returning visitor resumes (spec §17.9): the most recent one that is not
   * closed, scoped to this contact and bot. `contactId` comes from the visitor token, never
   * from the request body.
   */
  async latestOpenForContact(
    workspaceId: WorkspaceId,
    botId: string,
    contactId: string,
  ): Promise<ConversationEntity | null> {
    return this.ds.getRepository(ConversationEntity).findOne({
      where: { workspaceId, botId, contactId, status: Not('closed') },
      order: { lastMessageAt: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * Locks the conversation for the rest of the turn (spec §14.3): two requests for the same
   * conversation serialize here, so the second sees the first's streaming placeholder. Raw SQL
   * because TypeORM has no `SELECT … FOR UPDATE` through the repository API.
   */
  async lockForUpdate(
    workspaceId: WorkspaceId,
    id: string,
    manager: EntityManager,
  ): Promise<ConversationEntity> {
    const rows: unknown = await manager.query(
      `SELECT id FROM conversations WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [id, workspaceId],
    );
    if ((rows as unknown[]).length === 0) throw new AppError('not_found');

    const row = await manager
      .getRepository(ConversationEntity)
      .findOne({ where: { id, workspaceId } });
    if (row === null) throw new AppError('not_found');
    return row;
  }

  /** Hard-deletes old closed and AI-owned conversations, preserving any human handoff. */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    // Bound each delete so retention does not hold a large cascade open on busy instances.
    // Human-owned and waiting-for-human conversations are never removed automatically.
    const batchSize = 1_000;
    let total = 0;
    for (;;) {
      const deleted = await this.ds.query<{ id: string }[]>(
        `DELETE FROM conversations
         WHERE id IN (
           SELECT id
           FROM conversations
           WHERE last_message_at < $1
             AND status IN ('closed', 'ai')
           ORDER BY last_message_at ASC
           LIMIT $2
         )
         RETURNING id`,
        [cutoff, batchSize],
      );
      total += deleted.length;
      if (deleted.length < batchSize) return total;
    }
  }
}
