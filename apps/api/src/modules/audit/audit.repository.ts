// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import type { EntityManager, QueryDeepPartialEntity, Repository } from 'typeorm';
import { DataSource } from 'typeorm';

import type { Page } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { decodeCursor, encodeCursor } from '../../db/pagination';
import { AuditLogEntity } from './audit-log.entity';

export interface NewAuditEntry {
  workspaceId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
}

/**
 * Audit rows are append-only from the application's point of view: there is no update or
 * delete method. The workspace predicate on `list` is part of the repository, not the caller.
 */
@Injectable()
export class AuditRepository {
  constructor(private readonly ds: DataSource) {}

  async insert(row: NewAuditEntry, manager?: EntityManager): Promise<void> {
    // jsonb's `Record<string, unknown>` does not fit TypeORM's deep-partial index signature.
    await this.repository(manager).insert(row as unknown as QueryDeepPartialEntity<AuditLogEntity>);
  }

  async list(
    workspaceId: WorkspaceId,
    options: { limit: number; cursor: string | null },
  ): Promise<Page<AuditLogEntity>> {
    const query = this.repository()
      .createQueryBuilder('entry')
      .where('entry.workspaceId = :workspaceId', { workspaceId })
      .orderBy('entry.id', 'DESC')
      .take(options.limit + 1);
    if (options.cursor !== null) {
      query.andWhere('entry.id < :cursor', { cursor: decodeCursor(options.cursor) });
    }
    const rows = await query.getMany();
    const data = rows.slice(0, options.limit);
    const last = data.at(-1);
    return {
      data,
      nextCursor: rows.length > options.limit && last !== undefined ? encodeCursor(last.id) : null,
    };
  }

  private repository(manager?: EntityManager): Repository<AuditLogEntity> {
    return manager === undefined
      ? this.ds.getRepository(AuditLogEntity)
      : manager.getRepository(AuditLogEntity);
  }
}
