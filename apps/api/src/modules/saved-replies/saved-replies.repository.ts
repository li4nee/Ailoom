// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { SavedReplyEntity } from './saved-reply.entity';

@Injectable()
export class SavedRepliesRepository extends TenantRepository<SavedReplyEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(SavedReplyEntity));
  }

  async listForWorkspace(
    workspaceId: WorkspaceId,
    options: { query?: string; includeArchived: boolean },
    manager?: EntityManager,
  ): Promise<SavedReplyEntity[]> {
    const query = (manager ?? this.ds)
      .getRepository(SavedReplyEntity)
      .createQueryBuilder('reply')
      .where('reply.workspaceId = :workspaceId', { workspaceId })
      .orderBy('reply.sortOrder', 'ASC')
      .addOrderBy('reply.normalizedTitle', 'ASC')
      .addOrderBy('reply.id', 'ASC');
    if (!options.includeArchived) query.andWhere('reply.archivedAt IS NULL');
    if (options.query !== undefined) {
      query.andWhere(`(reply.normalizedTitle LIKE :query OR lower(reply.body) LIKE :query)`, {
        query: `%${options.query.toLowerCase()}%`,
      });
    }
    return query.take(200).getMany();
  }
}
