// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { ConversationEntity } from './entities/conversation.entity';

/** Conversations of one workspace. Every write is workspace-scoped. */
@Injectable()
export class ConversationsRepository extends TenantRepository<ConversationEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(ConversationEntity));
  }

  /**
   * Locks the conversation for the rest of the turn (spec §14.3): two requests for the same
   * conversation serialize here, so the second sees the first's streaming placeholder. Raw SQL
   * because TypeORM has no `SELECT … FOR UPDATE` through the repository API.
   */
  async lockForUpdate(
    workspaceId: WorkspaceId,
    id: string,
    manager: EntityManager,
  ): Promise<ConversationEntity> {
    const rows: unknown = await manager.query(
      `SELECT id FROM conversations WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [id, workspaceId],
    );
    if ((rows as unknown[]).length === 0) throw new AppError('not_found');

    const row = await manager
      .getRepository(ConversationEntity)
      .findOne({ where: { id, workspaceId } });
    if (row === null) throw new AppError('not_found');
    return row;
  }
}
