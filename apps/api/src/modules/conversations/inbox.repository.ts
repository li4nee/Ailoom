// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, In, Not } from 'typeorm';

import type {
  ConversationCounts,
  ConversationInboxQuery,
  ConversationStatus,
  HandoffReason,
  Priority,
} from '@app/shared';

import { AppError } from '../../common/errors';
import type { UserId, WorkspaceId } from '../../db/ids';
import { isUuid } from '../../db/ids';
import { UserEntity } from '../auth';
import { BotEntity } from '../bots';
import { ContactEntity } from './entities/contact.entity';
import { ConversationEntity } from './entities/conversation.entity';

/** A raw inbox row: the joins and the latest-message subqueries live in one query. */
export interface InboxRow {
  id: string;
  bot_id: string;
  bot_name: string;
  status: ConversationStatus;
  contact_id: string;
  contact_email: string | null;
  contact_name: string | null;
  assigned_user_id: string | null;
  assigned_name: string | null;
  handoff_reason: HandoffReason | null;
  handoff_requested_at: Date | null;
  last_message_at: Date;
  last_message_preview: string | null;
  unanswered_by_human: boolean;
  channel: string;
  priority: Priority;
  closed_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

interface InboxCursor {
  at: string;
  id: string;
}

/** Both sort fields travel in the cursor, so equal timestamps cannot skip or repeat a row. */
export function encodeInboxCursor(at: Date, id: string): string {
  const cursor: InboxCursor = { at: at.toISOString(), id };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeInboxCursor(cursor: string): { at: Date; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
    const { at, id } = parsed as Partial<InboxCursor>;
    if (typeof at !== 'string' || typeof id !== 'string' || !isUuid(id)) {
      throw new Error('invalid cursor fields');
    }
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) throw new Error('invalid cursor date');
    return { at: date, id };
  } catch {
    throw new AppError('validation_failed', { cause: cursor });
  }
}

/**
 * The inbox read model (spec §17.7). Postgres does the filtering, latest-message projection and
 * keyset pagination in one statement; the service only maps rows to the shared contract.
 */
@Injectable()
export class InboxQuery {
  constructor(private readonly ds: DataSource) {}

  async search(
    workspaceId: WorkspaceId,
    filters: ConversationInboxQuery,
    viewerUserId: UserId,
  ): Promise<{ data: InboxRow[]; nextCursor: string | null }> {
    const query = this.base(workspaceId)
      .orderBy('c.lastMessageAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .take(filters.limit + 1);

    if (filters.botId !== undefined) {
      query.andWhere('c.botId = :botId', { botId: filters.botId });
    }
    if (filters.status !== undefined) {
      query.andWhere('c.status = :status', { status: filters.status });
    }
    if (filters.assignedTo !== undefined) {
      if (filters.assignedTo === 'none') {
        query.andWhere('c.assignedUserId IS NULL');
      } else {
        query.andWhere('c.assignedUserId = :assignedTo', {
          assignedTo: filters.assignedTo === 'me' ? viewerUserId : filters.assignedTo,
        });
      }
    }
    if (filters.q !== undefined) {
      // websearch_to_tsquery treats quotes, &, ! and : as plain words instead of raising a
      // Postgres syntax error; email is matched exactly because it is not prose.
      query.andWhere(
        `(EXISTS (
            SELECT 1
              FROM messages m
             WHERE m.workspace_id = c.workspace_id
               AND m.conversation_id = c.id
               AND m.tsv @@ websearch_to_tsquery('simple', :q)
          )
          OR lower(btrim(ct.email)) = lower(btrim(:q)))`,
        { q: filters.q },
      );
    }
    if (filters.cursor !== undefined) {
      const cursor = decodeInboxCursor(filters.cursor);
      query.andWhere(
        '(c.lastMessageAt < :cursorAt OR (c.lastMessageAt = :cursorAt AND c.id < :cursorId))',
        { cursorAt: cursor.at, cursorId: cursor.id },
      );
    }

    const rows = await query.getRawMany<InboxRow>();
    const data = rows.slice(0, filters.limit);
    const last = data.at(-1);
    return {
      data,
      nextCursor:
        rows.length > filters.limit && last !== undefined
          ? encodeInboxCursor(last.last_message_at, last.id)
          : null,
    };
  }

  async counts(workspaceId: WorkspaceId, viewerUserId: UserId): Promise<ConversationCounts> {
    const repository = this.ds.getRepository(ConversationEntity);
    const [needsHuman, mine] = await Promise.all([
      repository.count({ where: { workspaceId, status: 'needs_human' } }),
      repository.count({
        where: { workspaceId, assignedUserId: viewerUserId, status: Not('closed') },
      }),
    ]);
    return { needsHuman, mine };
  }

  async detail(workspaceId: WorkspaceId, conversationId: string): Promise<InboxRow | null> {
    if (!isUuid(conversationId)) return null;
    return this.base(workspaceId)
      .andWhere('c.id = :conversationId', { conversationId })
      .getRawOne<InboxRow>()
      .then((row) => row ?? null);
  }

  /**
   * Trace ids keyed by AI message id. Raw SQL in this repository keeps the timeline to two
   * queries without importing the traces module, whose entity already imports conversations.
   */
  async traceIdsByMessageIds(
    workspaceId: WorkspaceId,
    messageIds: string[],
  ): Promise<Map<string, string>> {
    if (messageIds.length === 0) return new Map();
    const rows = await this.ds.query<{ id: string; message_id: string }[]>(
      `SELECT id, message_id
         FROM generation_traces
        WHERE workspace_id = $1 AND message_id = ANY($2::uuid[])`,
      [workspaceId, messageIds],
    );
    return new Map(rows.map((row) => [row.message_id, row.id]));
  }

  /** Display names for agent/system message authors and assignees. */
  async authorsByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.ds.getRepository(UserEntity).find({
      where: { id: In(ids) },
      select: { id: true, name: true, email: true },
    });
    return new Map(users.map((user) => [user.id, user.name ?? user.email]));
  }

  private base(workspaceId: WorkspaceId) {
    return this.ds
      .getRepository(ConversationEntity)
      .createQueryBuilder('c')
      .innerJoin(BotEntity, 'b', 'b.id = c.botId AND b.workspaceId = c.workspaceId')
      .innerJoin(ContactEntity, 'ct', 'ct.id = c.contactId AND ct.workspaceId = c.workspaceId')
      .leftJoin(UserEntity, 'u', 'u.id = c.assignedUserId')
      .select('c.id', 'id')
      .addSelect('c.bot_id', 'bot_id')
      .addSelect('b.name', 'bot_name')
      .addSelect('c.status', 'status')
      .addSelect('ct.id', 'contact_id')
      .addSelect('ct.email', 'contact_email')
      .addSelect('ct.name', 'contact_name')
      .addSelect('c.assigned_user_id', 'assigned_user_id')
      .addSelect('COALESCE(u.name, u.email)', 'assigned_name')
      .addSelect('c.handoff_reason', 'handoff_reason')
      .addSelect('c.handoff_requested_at', 'handoff_requested_at')
      .addSelect('c.last_message_at', 'last_message_at')
      .addSelect(
        `(SELECT left(m.content, 140)
            FROM messages m
           WHERE m.workspace_id = c.workspace_id
             AND m.conversation_id = c.id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 1)`,
        'last_message_preview',
      )
      .addSelect(
        `CASE
           WHEN c.status IN ('needs_human', 'human')
            AND COALESCE(
              (SELECT m.role = 'visitor'
                 FROM messages m
                WHERE m.workspace_id = c.workspace_id
                  AND m.conversation_id = c.id
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT 1),
              false
            )
           THEN true
           ELSE false
         END`,
        'unanswered_by_human',
      )
      .addSelect('c.channel', 'channel')
      .addSelect('c.priority', 'priority')
      .addSelect('c.closed_at', 'closed_at')
      .addSelect('c.metadata', 'metadata')
      .addSelect('c.created_at', 'created_at')
      .where('c.workspaceId = :workspaceId', { workspaceId });
  }
}
