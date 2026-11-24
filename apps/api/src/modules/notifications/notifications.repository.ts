// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type {
  NotificationDto,
  NotificationPayload,
  NotificationPreferences,
  NotificationQuery,
  NotificationType,
  Role,
} from '@app/shared';

import { AppError } from '../../common/errors';
import { newId } from '../../common/ids';
import { isUuid, type UserId, type WorkspaceId } from '../../db/ids';
import { decodeCursor, encodeCursor } from '../../db/pagination';
import { TenantRepository } from '../../db/tenant.repository';
import { NotificationEntity } from './notification.entity';

function toDto(row: NotificationEntity): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsRepository extends TenantRepository<NotificationEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(NotificationEntity));
  }

  async listForUser(
    workspaceId: WorkspaceId,
    userId: UserId,
    query: NotificationQuery,
  ): Promise<{ data: NotificationDto[]; nextCursor: string | null; unreadCount: number }> {
    const repo = this.ds.getRepository(NotificationEntity);
    const builder = repo
      .createQueryBuilder('notification')
      .where('notification.workspaceId = :workspaceId', { workspaceId })
      .andWhere('notification.userId = :userId', { userId });
    if (query.unread !== undefined) {
      builder.andWhere(
        query.unread ? 'notification.readAt IS NULL' : 'notification.readAt IS NOT NULL',
      );
    }
    if (query.cursor !== undefined) {
      const cursorId = decodeCursor(query.cursor);
      const cursorRow = await repo.findOne({ where: { workspaceId, userId, id: cursorId } });
      if (cursorRow === null) throw new AppError('validation_failed');
      builder.andWhere(
        '(notification.createdAt < :createdAt OR (notification.createdAt = :createdAt AND notification.id < :cursorId))',
        { createdAt: cursorRow.createdAt, cursorId },
      );
    }
    const rows = await builder
      .orderBy('notification.createdAt', 'DESC')
      .addOrderBy('notification.id', 'DESC')
      .take(query.limit + 1)
      .getMany();
    const unreadCount = await repo.count({ where: { workspaceId, userId, readAt: IsNull() } });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      data: page.map(toDto),
      nextCursor: hasMore ? encodeCursor(page.at(-1)?.id ?? '') : null,
      unreadCount,
    };
  }

  async create(
    workspaceId: WorkspaceId,
    userId: UserId,
    type: NotificationType,
    payload: NotificationPayload,
    manager: EntityManager,
    dedupeKey: string | null = null,
    now = new Date(),
  ): Promise<NotificationEntity> {
    if (dedupeKey !== null) {
      // Raw SQL is used so PostgreSQL's partial unread-dedupe index atomically collapses bursts.
      const rows = await manager.query<{ id: string }[]>(
        `INSERT INTO notifications (id, workspace_id, user_id, type, payload, dedupe_key, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (workspace_id, user_id, dedupe_key)
           WHERE read_at IS NULL AND dedupe_key IS NOT NULL
         DO UPDATE SET created_at = EXCLUDED.created_at, type = EXCLUDED.type, payload = EXCLUDED.payload
         RETURNING id`,
        [newId(), workspaceId, userId, type, JSON.stringify(payload), dedupeKey, now],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error('Notification upsert did not return an id.');
      const row = await manager.getRepository(NotificationEntity).findOne({
        where: { workspaceId, userId, id },
      });
      if (row === null) throw new Error('Notification upsert returned no row.');
      return row;
    }
    const id = newId();
    await manager.getRepository(NotificationEntity).insert({
      id,
      workspaceId,
      userId,
      type,
      payload,
      dedupeKey,
      createdAt: now,
    });
    const row = await manager
      .getRepository(NotificationEntity)
      .findOne({ where: { workspaceId, userId, id } });
    if (row === null) throw new Error('Inserted notification was not found.');
    return row;
  }

  async markRead(
    workspaceId: WorkspaceId,
    userId: UserId,
    notificationId: string,
    now: Date,
  ): Promise<NotificationDto> {
    if (!isUuid(notificationId)) throw new AppError('not_found');
    const repo = this.ds.getRepository(NotificationEntity);
    await repo.update(
      { workspaceId, userId, id: notificationId, readAt: IsNull() },
      { readAt: now },
    );
    const row = await repo.findOne({ where: { workspaceId, userId, id: notificationId } });
    if (row === null) throw new AppError('not_found');
    return toDto(row);
  }

  async markAllRead(workspaceId: WorkspaceId, userId: UserId, now: Date): Promise<number> {
    const result = await this.ds
      .getRepository(NotificationEntity)
      .createQueryBuilder()
      .update(NotificationEntity)
      .set({ readAt: now })
      .where('workspace_id = :workspaceId AND user_id = :userId AND read_at IS NULL', {
        workspaceId,
        userId,
      })
      .execute();
    return result.affected ?? 0;
  }

  async deleteExpired(now: Date): Promise<number> {
    // Raw SQL: one bounded statement applies the two fixed retention windows atomically.
    const rows = await this.ds.query<{ id: string }[]>(
      `DELETE FROM notifications
        WHERE created_at < $1
           OR (read_at IS NOT NULL AND read_at < $2)
        RETURNING id`,
      [new Date(now.getTime() - 180 * 86_400_000), new Date(now.getTime() - 90 * 86_400_000)],
    );
    return rows.length;
  }

  async membershipRecipients(
    workspaceId: WorkspaceId,
    roles: readonly Role[],
    manager: EntityManager,
    userIds?: readonly UserId[],
  ): Promise<
    { userId: UserId; email: string; role: Role; preferences: NotificationPreferences }[]
  > {
    // Raw SQL joins the membership-scoped recipient set and selects only delivery fields.
    return manager.query(
      `SELECT m.user_id AS "userId", u.email, m.role,
              m.notification_preferences AS preferences
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1
          AND ($2::role[] IS NULL OR m.role = ANY($2::role[]))
          AND ($3::uuid[] IS NULL OR m.user_id = ANY($3::uuid[]))
        ORDER BY m.user_id`,
      [workspaceId, roles.length === 0 ? null : roles, userIds ?? null],
    );
  }

  async hasInternalNotes(
    workspaceId: WorkspaceId,
    conversationId: string,
    manager: EntityManager,
  ): Promise<boolean> {
    const rows = await manager.query<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM conversation_internal_notes
          WHERE workspace_id = $1 AND conversation_id = $2
       ) AS exists`,
      [workspaceId, conversationId],
    );
    return rows[0]?.exists ?? false;
  }

  async workspaceEmails(workspaceId: WorkspaceId, manager: EntityManager): Promise<string[]> {
    const rows = await manager.query<{ emails: unknown }[]>(
      `SELECT settings->'notificationEmails' AS emails FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    const value = rows[0]?.emails;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
}
