// SPDX-License-Identifier: AGPL-3.0-only
import type {
  DeepPartial,
  EntityManager,
  FindOptionsOrder,
  FindOptionsWhere,
  QueryDeepPartialEntity,
  Repository,
} from 'typeorm';
import { LessThan } from 'typeorm';

import type { ErrorCode, Page } from '@app/shared';

import { AppError } from '../common/errors';
import { isUuid, type WorkspaceId } from './ids';
import { decodeCursor, encodeCursor } from './pagination';
import { isUniqueViolation } from './postgres-errors';
import type { TenantEntity } from './tenant-entity';

export interface ListOptions<T> {
  limit: number;
  cursor: string | null;
  where?: FindOptionsWhere<T>;
}

/**
 * Every read and write is scoped by workspace: the workspace predicate is added here, never
 * left to callers, so a missing check cannot leak or mutate another tenant's row.
 *
 * Rows are only ever created with `INSERT` and changed with a workspace-scoped `UPDATE`.
 * `Repository.save()` is never used: it turns into an `UPDATE` of whichever row owns a
 * caller-supplied primary key, in any workspace.
 *
 * Every method takes an optional `manager`: pass the one `DataSource.transaction()` hands you
 * to join the caller's transaction, so a rolled-back write leaves no row behind. Reads after a
 * write use the same manager, which is the only connection that can see the uncommitted row.
 */
export abstract class TenantRepository<T extends TenantEntity> {
  protected constructor(private readonly repo: Repository<T>) {}

  /** A malformed id cannot exist, and must not reach a `uuid` column (Postgres 22P02 -> 500). */
  async findById(workspaceId: WorkspaceId, id: string, manager?: EntityManager): Promise<T | null> {
    if (!isUuid(id)) return null;
    return this.repository(manager).findOne({
      where: { id, workspaceId } as FindOptionsWhere<T>,
    });
  }

  async getById(
    workspaceId: WorkspaceId,
    id: string,
    notFound: ErrorCode = 'not_found',
    manager?: EntityManager,
  ): Promise<T> {
    const row = await this.findById(workspaceId, id, manager);
    if (row === null) throw new AppError(notFound);
    return row;
  }

  async list(
    workspaceId: WorkspaceId,
    options: ListOptions<T>,
    manager?: EntityManager,
  ): Promise<Page<T>> {
    const where = {
      ...(options.where ?? {}),
      workspaceId,
      ...(options.cursor === null ? {} : { id: LessThan(decodeCursor(options.cursor)) }),
    } as FindOptionsWhere<T>;

    const rows = await this.repository(manager).find({
      where,
      order: { id: 'DESC' } as unknown as FindOptionsOrder<T>,
      take: options.limit + 1,
    });
    const data = rows.slice(0, options.limit);
    const last = data.at(-1);
    return {
      data,
      nextCursor: rows.length > options.limit && last !== undefined ? encodeCursor(last.id) : null,
    };
  }

  /**
   * Creates a row in `workspaceId`; a `workspaceId` (or a relation that sets it) in `data` is
   * ignored. A caller-supplied `id` that already exists, in any workspace, is a `conflict`:
   * it is never an update.
   */
  async insert(
    workspaceId: WorkspaceId,
    data: DeepPartial<T>,
    manager?: EntityManager,
  ): Promise<T> {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (!this.setsWorkspace(key)) payload[key] = value;
    }
    payload['workspaceId'] = workspaceId;

    const suppliedId = payload['id'];
    if (suppliedId !== undefined && !isUuid(suppliedId)) {
      throw new AppError('validation_failed', {
        details: [{ path: 'id', message: 'Must be a UUID.' }],
      });
    }

    let id: string;
    try {
      const result = await this.repository(manager).insert(payload as QueryDeepPartialEntity<T>);
      const generated: unknown = (result.identifiers[0] as Record<string, unknown> | undefined)?.[
        'id'
      ];
      if (typeof generated !== 'string') {
        throw new Error('The insert did not return the id of the new row.');
      }
      id = generated;
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('conflict', { cause: error });
      throw error;
    }
    return this.getById(workspaceId, id, 'not_found', manager);
  }

  /** `patch` may not touch the primary key or the workspace, directly or through a relation. */
  async updateById(
    workspaceId: WorkspaceId,
    id: string,
    patch: QueryDeepPartialEntity<T>,
    manager?: EntityManager,
  ): Promise<T> {
    this.assertPatchKeepsIdentity(patch);
    if (!isUuid(id)) throw new AppError('not_found');
    const result = await this.repository(manager).update(
      { id, workspaceId } as FindOptionsWhere<T>,
      patch,
    );
    if ((result.affected ?? 0) === 0) throw new AppError('not_found');
    return this.getById(workspaceId, id, 'not_found', manager);
  }

  async deleteById(workspaceId: WorkspaceId, id: string, manager?: EntityManager): Promise<void> {
    if (!isUuid(id)) throw new AppError('not_found');
    const result = await this.repository(manager).delete({
      id,
      workspaceId,
    } as FindOptionsWhere<T>);
    if ((result.affected ?? 0) === 0) throw new AppError('not_found');
  }

  /** True for `workspaceId` and for any relation property joined on the workspace column. */
  private setsWorkspace(propertyPath: string): boolean {
    return this.repo.metadata
      .findColumnsWithPropertyPath(propertyPath)
      .some((column) => column.propertyName === 'workspaceId');
  }

  private assertPatchKeepsIdentity(patch: QueryDeepPartialEntity<T>): void {
    for (const key of Object.keys(patch)) {
      const protectedColumn = this.repo.metadata
        .findColumnsWithPropertyPath(key)
        .some(
          (column) =>
            column.isPrimary ||
            column.propertyName === 'id' ||
            column.propertyName === 'workspaceId',
        );
      if (protectedColumn) {
        throw new AppError('validation_failed', {
          details: [{ path: key, message: 'This field cannot be changed.' }],
        });
      }
    }
  }

  private repository(manager?: EntityManager): Repository<T> {
    return manager === undefined ? this.repo : manager.getRepository(this.repo.target);
  }
}
