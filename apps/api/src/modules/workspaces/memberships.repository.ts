// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { Role } from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { MembershipEntity } from './entities/membership.entity';

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * Memberships have a composite primary key, so they cannot extend `TenantRepository`
 * (which assumes an `id`); every method still takes `workspaceId` first.
 */
@Injectable()
export class MembershipsRepository {
  constructor(private readonly ds: DataSource) {}

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

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  return (error.driverError as { code?: unknown } | undefined)?.code === UNIQUE_VIOLATION;
}
