// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { Role } from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { isUniqueViolation } from '../../db/postgres-errors';
import { MembershipEntity } from './entities/membership.entity';

export interface MembershipRow {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: Date;
}

/**
 * Memberships have a composite primary key, so they cannot extend `TenantRepository`
 * (which assumes an `id`); every method still takes `workspaceId` first.
 */
@Injectable()
export class MembershipsRepository {
  constructor(private readonly ds: DataSource) {}

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
}
