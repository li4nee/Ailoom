// SPDX-License-Identifier: AGPL-3.0-only
import type {
  DeepPartial,
  FindOptionsOrder,
  FindOptionsWhere,
  QueryDeepPartialEntity,
  Repository,
} from 'typeorm';
import { LessThan } from 'typeorm';

import type { ErrorCode, Page } from '@app/shared';

import { AppError } from '../common/errors';
import type { WorkspaceId } from './ids';
import { decodeCursor, encodeCursor } from './pagination';
import type { TenantEntity } from './tenant-entity';

export interface ListOptions<T> {
  limit: number;
  cursor: string | null;
  where?: FindOptionsWhere<T>;
}

/**
 * Every read and write is scoped by workspace: the workspace predicate is added here, never
 * left to callers, so a missing check cannot leak or mutate another tenant's row.
 */
export abstract class TenantRepository<T extends TenantEntity> {
  protected constructor(private readonly repo: Repository<T>) {}

  async findById(workspaceId: WorkspaceId, id: string): Promise<T | null> {
    return this.repo.findOne({ where: { id, workspaceId } as FindOptionsWhere<T> });
  }

  async getById(
    workspaceId: WorkspaceId,
    id: string,
    notFound: ErrorCode = 'not_found',
  ): Promise<T> {
    const row = await this.findById(workspaceId, id);
    if (row === null) throw new AppError(notFound);
    return row;
  }

  async list(workspaceId: WorkspaceId, options: ListOptions<T>): Promise<Page<T>> {
    const where = {
      ...(options.where ?? {}),
      workspaceId,
      ...(options.cursor === null ? {} : { id: LessThan(decodeCursor(options.cursor)) }),
    } as FindOptionsWhere<T>;

    const rows = await this.repo.find({
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

  async insert(workspaceId: WorkspaceId, data: DeepPartial<T>): Promise<T> {
    const payload: Record<string, unknown> = {
      ...(data as Record<string, unknown>),
      workspaceId,
    };
    return this.repo.save(this.repo.create(payload as DeepPartial<T>));
  }

  async updateById(
    workspaceId: WorkspaceId,
    id: string,
    patch: QueryDeepPartialEntity<T>,
  ): Promise<T> {
    const result = await this.repo.update({ id, workspaceId } as FindOptionsWhere<T>, patch);
    if ((result.affected ?? 0) === 0) throw new AppError('not_found');
    return this.getById(workspaceId, id);
  }

  async deleteById(workspaceId: WorkspaceId, id: string): Promise<void> {
    const result = await this.repo.delete({ id, workspaceId } as FindOptionsWhere<T>);
    if ((result.affected ?? 0) === 0) throw new AppError('not_found');
  }
}
