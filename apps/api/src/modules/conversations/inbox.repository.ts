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
  workflow_version: number;
  contact_id: string;
  contact_email: string | null;
  contact_name: string | null;
  assigned_user_id: string | null;
  assigned_name: string | null;
  handoff_reason: HandoffReason | null;
  handoff_requested_at: Date | null;
  first_response_due_at: Date | null;
  resolution_due_at: Date | null;
  first_response_breached_at: Date | null;
  resolution_breached_at: Date | null;
  outcome_first_agent_reply_at: Date | null;
  last_message_at: Date;
  last_message_preview: string | null;
  unanswered_by_human: boolean;
  channel: string;
  priority: Priority;
  closed_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

/** Contact attributes are fetched only for the conversation detail, never for inbox rows. */
export interface ContactContextInboxRow extends InboxRow {
  contact_external_id: string | null;
  contact_attributes: Record<string, unknown> | null;
  contact_first_seen_at: Date;
  contact_last_seen_at: Date;
}

interface InboxCursor {
  needsHuman: boolean;
  priority: Priority;
  at: string;
  id: string;
}

/** What a handoff notification email needs, in one query. */
export interface HandoffNotificationContext {
  bot_name: string;
  contact_email: string | null;
  handoff_reason: HandoffReason | null;
  last_visitor_message: string | null;
}

export interface ContactCrmLinkRow {
  integration_id: string;
  integration_name: string;
  provider: string;
  external_account_id: string | null;
  object_type: string;
  external_object_id: string;
}

/** Every sort key travels in the cursor, so pagination stays stable across priority groups. */
export function encodeInboxCursor(
  row: Pick<InboxRow, 'status' | 'priority' | 'last_message_at' | 'id'>,
): string {
  const cursor: InboxCursor = {
    needsHuman: row.status === 'needs_human',
    priority: row.priority,
    at: row.last_message_at.toISOString(),
    id: row.id,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeInboxCursor(cursor: string): {
  needsHuman: boolean;
  priority: Priority;
  at: Date;
  id: string;
} {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
    const { at, id, needsHuman, priority } = parsed as Partial<InboxCursor>;
    if (
      typeof at !== 'string' ||
      typeof id !== 'string' ||
      !isUuid(id) ||
      typeof needsHuman !== 'boolean' ||
      priority === undefined ||
      !['low', 'normal', 'high', 'urgent'].includes(priority)
    ) {
      throw new Error('invalid cursor fields');
    }
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) throw new Error('invalid cursor date');
    return { needsHuman, priority, at: date, id };
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
    const statusRank = "CASE WHEN c.status = 'needs_human' THEN 0 ELSE 1 END";
    const priorityRank =
      "CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END";
    const query = this.base(workspaceId);
    if (filters.status === undefined) {
      query.orderBy(statusRank, 'ASC');
    }
    // priority is an enum declared low < normal < high < urgent, so DESC matches the inbox
    // rank and allows a status-filtered inbox to use conversations_inbox_priority_status.
    query
      .addOrderBy('c.priority', 'DESC')
      .addOrderBy('c.lastMessageAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      // limit(), not take(): with joins, take() only paginates entity queries and is dropped
      // from getRawMany(), which loaded every matching conversation.
      .limit(filters.limit + 1);

    if (filters.botId !== undefined) {
      query.andWhere('c.botId = :botId', { botId: filters.botId });
    }
    if (filters.status !== undefined) {
      query.andWhere('c.status = :status', { status: filters.status });
    }
    if (filters.priority !== undefined) {
      query.andWhere('c.priority = :priority', { priority: filters.priority });
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
        `(${statusRank} > :cursorStatusRank OR (${statusRank} = :cursorStatusRank AND
          (${priorityRank} > :cursorPriorityRank OR (${priorityRank} = :cursorPriorityRank AND
            (c.lastMessageAt < :cursorAt OR (c.lastMessageAt = :cursorAt AND c.id < :cursorId))))))`,
        {
          cursorStatusRank: cursor.needsHuman ? 0 : 1,
          cursorPriorityRank: { urgent: 0, high: 1, normal: 2, low: 3 }[cursor.priority],
          cursorAt: cursor.at,
          cursorId: cursor.id,
        },
      );
    }

    const rows = await query.getRawMany<InboxRow>();
    const data = rows.slice(0, filters.limit);
    const last = data.at(-1);
    return {
      data,
      nextCursor:
        rows.length > filters.limit && last !== undefined ? encodeInboxCursor(last) : null,
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

  async detail(
    workspaceId: WorkspaceId,
    conversationId: string,
  ): Promise<ContactContextInboxRow | null> {
    if (!isUuid(conversationId)) return null;
    return this.base(workspaceId)
      .addSelect('ct.external_id', 'contact_external_id')
      .addSelect('ct.attributes', 'contact_attributes')
      .addSelect('ct.first_seen_at', 'contact_first_seen_at')
      .addSelect('ct.last_seen_at', 'contact_last_seen_at')
      .andWhere('c.id = :conversationId', { conversationId })
      .getRawOne<ContactContextInboxRow>()
      .then((row) => row ?? null);
  }

  async contactHistory(
    workspaceId: WorkspaceId,
    contactId: string,
    currentConversationId: string,
  ): Promise<InboxRow[]> {
    return this.base(workspaceId)
      .andWhere('c.contactId = :contactId', { contactId })
      .andWhere('c.id <> :currentConversationId', { currentConversationId })
      .orderBy('c.lastMessageAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .limit(10)
      .getRawMany<InboxRow>();
  }

  async contactCrmLinks(workspaceId: WorkspaceId, contactId: string): Promise<ContactCrmLinkRow[]> {
    return this.ds.query<ContactCrmLinkRow[]>(
      `SELECT i.id AS integration_id, i.name AS integration_name, i.provider,
              i.external_account_id, l.object_type, l.external_object_id
         FROM contact_external_links l
         JOIN integrations i ON i.workspace_id = l.workspace_id AND i.id = l.integration_id
        WHERE l.workspace_id = $1 AND l.contact_id = $2
        ORDER BY i.name, l.object_type, l.external_object_id`,
      [workspaceId, contactId],
    );
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

  /** Bot, contact and last visitor message for the handoff email (one statement). */
  async handoffNotificationContext(
    workspaceId: WorkspaceId,
    conversationId: string,
  ): Promise<HandoffNotificationContext | null> {
    const rows = await this.ds.query<HandoffNotificationContext[]>(
      `SELECT b.name AS bot_name,
              ct.email AS contact_email,
              c.handoff_reason,
              (SELECT left(m.content, 500)
                 FROM messages m
                WHERE m.workspace_id = c.workspace_id
                  AND m.conversation_id = c.id
                  AND m.role = 'visitor'
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT 1) AS last_visitor_message
         FROM conversations c
         JOIN bots b ON b.id = c.bot_id AND b.workspace_id = c.workspace_id
         JOIN contacts ct ON ct.id = c.contact_id AND ct.workspace_id = c.workspace_id
        WHERE c.workspace_id = $1 AND c.id = $2`,
      [workspaceId, conversationId],
    );
    return rows[0] ?? null;
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
      .addSelect('c.workflow_version', 'workflow_version')
      .addSelect('ct.id', 'contact_id')
      .addSelect('ct.email', 'contact_email')
      .addSelect('ct.name', 'contact_name')
      .addSelect('c.assigned_user_id', 'assigned_user_id')
      .addSelect('COALESCE(u.name, u.email)', 'assigned_name')
      .addSelect('c.handoff_reason', 'handoff_reason')
      .addSelect('c.handoff_requested_at', 'handoff_requested_at')
      .addSelect('c.first_response_due_at', 'first_response_due_at')
      .addSelect('c.resolution_due_at', 'resolution_due_at')
      .addSelect('c.first_response_breached_at', 'first_response_breached_at')
      .addSelect('c.resolution_breached_at', 'resolution_breached_at')
      .addSelect('c.outcome_first_agent_reply_at', 'outcome_first_agent_reply_at')
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
