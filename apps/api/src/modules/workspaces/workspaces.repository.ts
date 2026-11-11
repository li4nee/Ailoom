// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, type EntityManager, type Repository } from 'typeorm';

import type { Role } from '@app/shared';

import { AppError } from '../../common/errors';
import { isUuid, type UserId } from '../../db/ids';
import { isUniqueViolation } from '../../db/postgres-errors';
import { WorkspaceEntity } from './entities/workspace.entity';

export interface WorkspaceSummaryRow {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  role: Role;
}

/**
 * Workspaces are the tenant root, not tenant rows, so this repository is not a
 * `TenantRepository`. Reads exclude soft-deleted workspaces everywhere.
 */
@Injectable()
export class WorkspacesRepository {
  constructor(private readonly ds: DataSource) {}

  async insert(
    input: { name: string; slug: string },
    manager?: EntityManager,
  ): Promise<WorkspaceEntity> {
    try {
      const result = await this.repository(manager).insert(input);
      const generated: unknown = (result.identifiers[0] as Record<string, unknown> | undefined)?.[
        'id'
      ];
      if (typeof generated !== 'string') {
        throw new Error('The insert did not return the id of the new workspace.');
      }
      const workspace = await this.repository(manager).findOneBy({ id: generated });
      if (workspace === null) throw new AppError('internal_error');
      return workspace;
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('conflict', { cause: error });
      throw error;
    }
  }

  async findById(id: string): Promise<WorkspaceEntity | null> {
    if (!isUuid(id)) return null;
    return this.repository().findOne({ where: { id, deletedAt: IsNull() } });
  }

  /** Every live workspace the user belongs to, with their role. */
  async listForUser(userId: UserId): Promise<WorkspaceSummaryRow[]> {
    return this.repository()
      .createQueryBuilder('workspace')
      .select('workspace.id', 'id')
      .addSelect('workspace.name', 'name')
      .addSelect('workspace.slug', 'slug')
      .addSelect('workspace.settings', 'settings')
      .addSelect('membership.role', 'role')
      .innerJoin('memberships', 'membership', 'membership.workspace_id = workspace.id')
      .where('membership.user_id = :userId', { userId })
      .andWhere('workspace.deleted_at IS NULL')
      .orderBy('workspace.name', 'ASC')
      .addOrderBy('workspace.id', 'ASC')
      .getRawMany<WorkspaceSummaryRow>();
  }

  /**
   * `settings` keys are merged into the stored object, not replacing it. The row is locked
   * for the read-merge-write, so concurrent updates of different keys cannot drop each other;
   * call inside a transaction for the lock to hold until the write.
   */
  async update(
    id: string,
    patch: { name?: string; settings?: Record<string, unknown> },
    manager?: EntityManager,
  ): Promise<WorkspaceEntity> {
    if (!isUuid(id)) throw new AppError('not_found');
    const repository = this.repository(manager);
    const workspace = await repository.findOne({
      where: { id, deletedAt: IsNull() },
      ...(manager === undefined ? {} : { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (workspace === null) throw new AppError('not_found');
    const { settings, ...rest } = patch;
    repository.merge(workspace, rest);
    if (settings !== undefined) workspace.settings = { ...workspace.settings, ...settings };
    return repository.save(workspace);
  }

  /** Marks a live workspace deleted; false when it was already deleted or never existed. */
  async softDelete(id: string, deletedAt: Date, manager: EntityManager): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await this.repository(manager).update(
      { id, deletedAt: IsNull() },
      { deletedAt },
    );
    return (result.affected ?? 0) > 0;
  }

  private repository(manager?: EntityManager): Repository<WorkspaceEntity> {
    return manager === undefined
      ? this.ds.getRepository(WorkspaceEntity)
      : manager.getRepository(WorkspaceEntity);
  }
}
