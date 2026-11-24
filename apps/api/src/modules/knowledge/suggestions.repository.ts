// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';

import type {
  AgentReview,
  ConversationStatus,
  KnowledgeSuggestionDto,
  KnowledgeSuggestionQuery,
} from '@app/shared';

import { AppError } from '../../common/errors';
import { isUuid } from '../../db/ids';
import type { UserId, WorkspaceId } from '../../db/ids';
import { decodeCursor, encodeCursor } from '../../db/pagination';
import { TenantRepository } from '../../db/tenant.repository';
import { KnowledgeSuggestionEntity } from './entities/knowledge-suggestion.entity';

export interface ReviewConversationRow {
  id: string;
  botId: string;
  status: ConversationStatus;
}

export interface ReviewMessageRow {
  id: string;
  role: string;
  status: string;
  createdAt: Date;
  agentReview: AgentReview | null;
}

function toDto(row: KnowledgeSuggestionEntity): KnowledgeSuggestionDto {
  return {
    id: row.id,
    botId: row.botId,
    botName: row.bot.name,
    messageId: row.messageId,
    conversationId: row.conversationId,
    question: row.question,
    answer: row.answer,
    status: row.status,
    createdBy:
      row.createdByUser === null
        ? null
        : { id: row.createdByUser.id, name: row.createdByUser.name },
    reviewedBy:
      row.reviewedByUser === null
        ? null
        : { id: row.reviewedByUser.id, name: row.reviewedByUser.name },
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectReason: row.rejectReason,
    sourceId: row.sourceId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Tenant-scoped reads and writes for the correction queue. */
@Injectable()
export class SuggestionsRepository extends TenantRepository<KnowledgeSuggestionEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(KnowledgeSuggestionEntity));
  }

  async lockConversation(
    workspaceId: WorkspaceId,
    conversationId: string,
    manager: EntityManager,
  ): Promise<ReviewConversationRow | null> {
    const rows = await manager.query<ReviewConversationRow[]>(
      `SELECT id, bot_id AS "botId", status FROM conversations
        WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
      [workspaceId, conversationId],
    );
    return rows[0] ?? null;
  }

  async lockMessage(
    workspaceId: WorkspaceId,
    conversationId: string,
    messageId: string,
    manager: EntityManager,
  ): Promise<ReviewMessageRow | null> {
    const rows = await manager.query<ReviewMessageRow[]>(
      `SELECT id, role, status, created_at AS "createdAt", agent_review AS "agentReview"
         FROM messages
        WHERE workspace_id = $1 AND conversation_id = $2 AND id = $3
        FOR UPDATE`,
      [workspaceId, conversationId, messageId],
    );
    return rows[0] ?? null;
  }

  async nearestVisitorQuestion(
    workspaceId: WorkspaceId,
    conversationId: string,
    before: Date,
    manager: EntityManager,
  ): Promise<string> {
    const rows = await manager.query<{ content: string }[]>(
      `SELECT content FROM messages
        WHERE workspace_id = $1 AND conversation_id = $2
          AND role = 'visitor' AND created_at <= $3
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [workspaceId, conversationId, before],
    );
    return rows[0]?.content.trim().slice(0, 1000) ?? '';
  }

  async lockPendingForMessage(
    workspaceId: WorkspaceId,
    messageId: string,
    manager: EntityManager,
  ): Promise<KnowledgeSuggestionEntity | null> {
    const repo = this.suggestionRepository(manager);
    return repo
      .createQueryBuilder('suggestion')
      .setLock('pessimistic_write')
      .where('suggestion.workspaceId = :workspaceId', { workspaceId })
      .andWhere('suggestion.messageId = :messageId', { messageId })
      .andWhere('suggestion.status = :status', { status: 'pending' })
      .getOne();
  }

  async savePending(input: {
    workspaceId: WorkspaceId;
    botId: string;
    messageId: string;
    conversationId: string;
    question: string;
    answer: string;
    createdBy: UserId;
    now: Date;
    existing: KnowledgeSuggestionEntity | null;
    manager: EntityManager;
  }): Promise<KnowledgeSuggestionEntity> {
    const repo = this.suggestionRepository(input.manager);
    if (input.existing !== null) {
      await repo.update(
        { workspaceId: input.workspaceId, id: input.existing.id },
        {
          question: input.question,
          answer: input.answer,
          createdBy: input.createdBy,
          reviewedBy: null,
          reviewedAt: null,
          rejectReason: null,
          sourceId: null,
          status: 'pending',
        },
      );
      return this.get(input.workspaceId, input.existing.id, input.manager);
    }
    // Raw SQL returns the database-generated UUID while keeping the insert in the review transaction.
    const rows = await input.manager.query<{ id: string }[]>(
      `INSERT INTO knowledge_suggestions
         (workspace_id, bot_id, message_id, conversation_id, question, answer, status,
          created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
       RETURNING id`,
      [
        input.workspaceId,
        input.botId,
        input.messageId,
        input.conversationId,
        input.question,
        input.answer,
        input.createdBy,
        input.now,
      ],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('The suggestion insert did not return an id.');
    return this.get(input.workspaceId, id, input.manager);
  }

  async updateReview(
    workspaceId: WorkspaceId,
    conversationId: string,
    messageId: string,
    review: AgentReview,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `UPDATE messages SET agent_review = $4::jsonb
        WHERE workspace_id = $1 AND conversation_id = $2 AND id = $3`,
      [workspaceId, conversationId, messageId, JSON.stringify(review)],
    );
  }

  async deletePendingForMessage(
    workspaceId: WorkspaceId,
    messageId: string,
    manager: EntityManager,
  ): Promise<void> {
    await this.suggestionRepository(manager).delete({ workspaceId, messageId, status: 'pending' });
  }

  async get(
    workspaceId: WorkspaceId,
    id: string,
    manager?: EntityManager,
  ): Promise<KnowledgeSuggestionEntity> {
    const row = await this.withRelations(manager)
      .createQueryBuilder('suggestion')
      .leftJoinAndSelect('suggestion.bot', 'bot')
      .leftJoinAndSelect('suggestion.createdByUser', 'createdByUser')
      .leftJoinAndSelect('suggestion.reviewedByUser', 'reviewedByUser')
      .where('suggestion.workspaceId = :workspaceId', { workspaceId })
      .andWhere('suggestion.id = :id', { id })
      .getOne();
    if (row === null) throw new AppError('not_found');
    return row;
  }

  async getDto(workspaceId: WorkspaceId, id: string, manager?: EntityManager) {
    return toDto(await this.get(workspaceId, id, manager));
  }

  async listSuggestions(
    workspaceId: WorkspaceId,
    query: KnowledgeSuggestionQuery,
  ): Promise<{ data: KnowledgeSuggestionDto[]; nextCursor: string | null }> {
    const qb = this.withRelations()
      .createQueryBuilder('suggestion')
      .leftJoinAndSelect('suggestion.bot', 'bot')
      .leftJoinAndSelect('suggestion.createdByUser', 'createdByUser')
      .leftJoinAndSelect('suggestion.reviewedByUser', 'reviewedByUser')
      .where('suggestion.workspaceId = :workspaceId', { workspaceId });
    if (query.status !== undefined)
      qb.andWhere('suggestion.status = :status', { status: query.status });
    if (query.botId !== undefined) qb.andWhere('suggestion.botId = :botId', { botId: query.botId });
    if (query.cursor !== undefined) {
      qb.andWhere('suggestion.id < :cursor', { cursor: decodeCursor(query.cursor) });
    }
    const rows = await qb
      .orderBy('suggestion.id', 'DESC')
      .take(query.limit + 1)
      .getMany();
    const data = rows.slice(0, query.limit);
    const last = data.at(-1);
    return {
      data: data.map(toDto),
      nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.id) : null,
    };
  }

  async findBot(
    workspaceId: WorkspaceId,
    botId: string,
    manager: EntityManager,
  ): Promise<{ deletedAt: Date | null } | null> {
    const rows = await manager.query<{ deletedAt: Date | null }[]>(
      `SELECT deleted_at AS "deletedAt" FROM bots
        WHERE workspace_id = $1 AND id = $2 FOR KEY SHARE`,
      [workspaceId, botId],
    );
    return rows[0] ?? null;
  }

  async lockSuggestion(
    workspaceId: WorkspaceId,
    id: string,
    manager: EntityManager,
  ): Promise<KnowledgeSuggestionEntity | null> {
    if (!isUuid(id)) return null;
    return this.suggestionRepository(manager)
      .createQueryBuilder('suggestion')
      .setLock('pessimistic_write')
      .where('suggestion.workspaceId = :workspaceId', { workspaceId })
      .andWhere('suggestion.id = :id', { id })
      .getOne();
  }

  async setDecision(
    workspaceId: WorkspaceId,
    id: string,
    decision: {
      status: 'approved' | 'rejected';
      reviewedBy: UserId;
      reviewedAt: Date;
      rejectReason: string | null;
      sourceId?: string;
      question?: string;
      answer?: string;
    },
    manager: EntityManager,
  ): Promise<void> {
    await this.suggestionRepository(manager).update(
      { workspaceId, id },
      {
        status: decision.status,
        reviewedBy: decision.reviewedBy,
        reviewedAt: decision.reviewedAt,
        rejectReason: decision.rejectReason,
        ...(decision.sourceId === undefined ? {} : { sourceId: decision.sourceId }),
        ...(decision.question === undefined ? {} : { question: decision.question }),
        ...(decision.answer === undefined ? {} : { answer: decision.answer }),
      },
    );
  }

  private withRelations(manager?: EntityManager): Repository<KnowledgeSuggestionEntity> {
    return this.suggestionRepository(manager);
  }

  private suggestionRepository(manager?: EntityManager): Repository<KnowledgeSuggestionEntity> {
    return manager === undefined
      ? this.ds.getRepository(KnowledgeSuggestionEntity)
      : manager.getRepository(KnowledgeSuggestionEntity);
  }
}
