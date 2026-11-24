// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { NotificationPreferences, Role } from '@app/shared';

import { AppError } from '../../common/errors';
import { isUuid, type WorkspaceId } from '../../db/ids';
import { isUniqueViolation } from '../../db/postgres-errors';
import { MembershipEntity } from './entities/membership.entity';

export interface MembershipRow {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: Date;
}

export interface MembershipPreferencesRow {
  role: Role;
  notificationPreferences: NotificationPreferences;
}

/**
 * Memberships have a composite primary key, so they cannot extend `TenantRepository`
 * (which assumes an `id`); every method still takes `workspaceId` first.
 */
@Injectable()
export class MembershipsRepository {
  constructor(private readonly ds: DataSource) {}

  async notificationPreferences(
    workspaceId: WorkspaceId,
    userId: string,
    manager?: EntityManager,
  ): Promise<MembershipPreferencesRow | null> {
    const repository =
      manager?.getRepository(MembershipEntity) ?? this.ds.getRepository(MembershipEntity);
    const row = await repository.findOne({ where: { workspaceId, userId } });
    return row === null
      ? null
      : { role: row.role, notificationPreferences: row.notificationPreferences };
  }

  async updateNotificationPreferences(
    workspaceId: WorkspaceId,
    userId: string,
    notificationPreferences: NotificationPreferences,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .getRepository(MembershipEntity)
      .update({ workspaceId, userId }, { notificationPreferences });
  }

  /** Members of one workspace, owner first and then by email. */
  async listForWorkspace(workspaceId: WorkspaceId): Promise<MembershipRow[]> {
    return this.ds.query<MembershipRow[]>(
      `SELECT m.user_id AS "userId", u.email, u.name, m.role, m.created_at AS "createdAt"
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                 lower(u.email)`,
      [workspaceId],
    );
  }

  async insert(
    workspaceId: WorkspaceId,
    userId: string,
    role: Role,
    manager?: EntityManager,
  ): Promise<void> {
    const repository =
      manager === undefined
        ? this.ds.getRepository(MembershipEntity)
        : manager.getRepository(MembershipEntity);
    try {
      await repository.insert({ workspaceId, userId, role });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('conflict', { cause: error });
      throw error;
    }
  }

  /** One member with their user details, or null when they do not belong to the workspace. */
  async findMember(workspaceId: WorkspaceId, userId: string): Promise<MembershipRow | null> {
    if (!isUuid(userId)) return null;
    const rows = await this.ds.query<MembershipRow[]>(
      `SELECT m.user_id AS "userId", u.email, u.name, m.role, m.created_at AS "createdAt"
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1 AND m.user_id = $2`,
      [workspaceId, userId],
    );
    return rows[0] ?? null;
  }

  /**
   * Locks the membership rows of the given users for the rest of the transaction, so a role
   * change, removal and ownership transfer touching the same member serialize. Returns the
   * role of each user that is a member.
   */
  async lockRoles(
    workspaceId: WorkspaceId,
    userIds: string[],
    manager: EntityManager,
  ): Promise<Map<string, Role>> {
    const ids = userIds.filter(isUuid);
    if (ids.length === 0) return new Map();
    const rows = await manager
      .getRepository(MembershipEntity)
      .createQueryBuilder('membership')
      .setLock('pessimistic_write')
      .where('membership.workspaceId = :workspaceId', { workspaceId })
      .andWhere('membership.userId IN (:...ids)', { ids })
      .getMany();
    return new Map(rows.map((row) => [row.userId, row.role]));
  }

  async updateRole(
    workspaceId: WorkspaceId,
    userId: string,
    role: Role,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(MembershipEntity).update({ workspaceId, userId }, { role });
  }

  async delete(workspaceId: WorkspaceId, userId: string, manager: EntityManager): Promise<void> {
    await manager.getRepository(MembershipEntity).delete({ workspaceId, userId });
  }
}
