// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, MoreThan } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { MessageEntity } from './entities/message.entity';

export interface TurnState {
  count: number;
  hasStreaming: boolean;
}

/** Messages of one workspace. */
@Injectable()
export class MessagesRepository extends TenantRepository<MessageEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(MessageEntity));
  }

  /** The conversation message cap (spec §9.4) counts both visitor and AI messages. */
  async countForConversation(
    workspaceId: WorkspaceId,
    conversationId: string,
    manager: EntityManager,
  ): Promise<number> {
    const rows: unknown = await manager.query(
      `SELECT count(*)::int AS count
         FROM messages
        WHERE workspace_id = $1 AND conversation_id = $2`,
      [workspaceId, conversationId],
    );
    return (rows as { count: number }[])[0]?.count ?? 0;
  }

  /** Reads the two admission checks used by chat turn creation in one database round trip. */
  async turnState(
    workspaceId: WorkspaceId,
    conversationId: string,
    since: Date,
    manager: EntityManager,
  ): Promise<TurnState> {
    const rows: unknown = await manager.query(
      `SELECT count(*)::int AS count,
              EXISTS (
                SELECT 1
                  FROM messages streaming
                 WHERE streaming.workspace_id = $1
                   AND streaming.conversation_id = $2
                   AND streaming.role = 'ai'
                   AND streaming.status = 'streaming'
                   AND streaming.created_at > $3
              ) AS has_streaming
         FROM messages
        WHERE workspace_id = $1 AND conversation_id = $2`,
      [workspaceId, conversationId, since],
    );
    const row = (rows as { count: number; has_streaming: boolean }[])[0];
    return { count: row?.count ?? 0, hasStreaming: row?.has_streaming ?? false };
  }

  /**
   * A turn is in flight when an AI placeholder is still `streaming` and younger than the stuck
   * window (spec §14.1); an older one is a dead stream and must not block the visitor forever.
   */
  async hasStreamingSince(
    workspaceId: WorkspaceId,
    conversationId: string,
    since: Date,
    manager: EntityManager,
  ): Promise<boolean> {
    const rows: unknown = await manager.query(
      `SELECT 1
         FROM messages
        WHERE workspace_id = $1
          AND conversation_id = $2
          AND role = 'ai'
          AND status = 'streaming'
          AND created_at > $3
        LIMIT 1`,
      [workspaceId, conversationId, since],
    );
    return (rows as unknown[]).length > 0;
  }

  /**
   * The messages inserted after `afterId`, oldest first (spec §17.9 replay). uuidv7 keys sort
   * by creation time, so `id >` is the cursor the widget's `Last-Event-ID` carries.
   */
  async listAfterId(
    workspaceId: WorkspaceId,
    conversationId: string,
    afterId: string,
  ): Promise<MessageEntity[]> {
    return this.ds.getRepository(MessageEntity).find({
      where: { workspaceId, conversationId, id: MoreThan(afterId) },
      order: { id: 'ASC' },
    });
  }

  /**
   * The tail of a conversation, oldest first: the widget shows the latest 50 messages on a
   * resume (spec §17.9), so the limit belongs in the query rather than in a full load.
   */
  async listRecentForConversation(
    workspaceId: WorkspaceId,
    conversationId: string,
    limit: number,
    manager?: EntityManager,
  ): Promise<MessageEntity[]> {
    const rows = await this.repositoryFor(manager).find({
      where: { workspaceId, conversationId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });
    return rows.reverse();
  }

  /** Agent messages newer than the contact's last emailed reply (spec §17.7). */
  async listAgentMessagesSince(
    workspaceId: WorkspaceId,
    conversationId: string,
    since: Date | null,
  ): Promise<MessageEntity[]> {
    const repository = this.ds.getRepository(MessageEntity);
    if (since === null) {
      return repository.find({
        where: { workspaceId, conversationId, role: 'agent' },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    }
    return repository
      .createQueryBuilder('m')
      .where('m.workspaceId = :workspaceId', { workspaceId })
      .andWhere('m.conversationId = :conversationId', { conversationId })
      .andWhere('m.role = :role', { role: 'agent' })
      .andWhere('m.createdAt > :since', { since })
      .orderBy('m.createdAt', 'ASC')
      .addOrderBy('m.id', 'ASC')
      .getMany();
  }

  async listForConversation(
    workspaceId: WorkspaceId,
    conversationId: string,
    manager?: EntityManager,
  ): Promise<MessageEntity[]> {
    return this.repositoryFor(manager).find({
      where: { workspaceId, conversationId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  private repositoryFor(manager?: EntityManager): Repository<MessageEntity> {
    return manager === undefined
      ? this.ds.getRepository(MessageEntity)
      : manager.getRepository(MessageEntity);
  }
}
