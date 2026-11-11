// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { PromptVersionEntity } from '../bots';

/** A bot's prompt versions. Rows are append-only: no update or delete exists anywhere. */
@Injectable()
export class PromptVersionsRepository extends TenantRepository<PromptVersionEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(PromptVersionEntity));
  }

  /** Newest first: the editor shows the active version at the top. */
  async listForBot(workspaceId: WorkspaceId, botId: string): Promise<PromptVersionEntity[]> {
    return this.ds.getRepository(PromptVersionEntity).find({
      where: { workspaceId, botId },
      order: { version: 'DESC' },
    });
  }

  /**
   * Locks the bot row for the rest of the transaction, so two concurrent saves cannot read the
   * same `max(version)` and insert a duplicate. 404 for another workspace, a missing bot and a
   * soft-deleted bot alike.
   */
  async lockBot(workspaceId: WorkspaceId, botId: string, manager: EntityManager): Promise<void> {
    const rows: unknown = await manager.query(
      `SELECT id FROM bots
        WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [botId, workspaceId],
    );
    if ((rows as unknown[]).length === 0) throw new AppError('not_found');
  }

  /** `max(version) + 1` inside the caller's transaction, after `lockBot`. */
  async nextVersion(
    workspaceId: WorkspaceId,
    botId: string,
    manager: EntityManager,
  ): Promise<number> {
    const rows: unknown = await manager.query(
      `SELECT coalesce(max(version), 0) + 1 AS next
         FROM prompt_versions
        WHERE workspace_id = $1 AND bot_id = $2`,
      [workspaceId, botId],
    );
    const next = (rows as { next: number }[])[0]?.next;
    if (next === undefined) throw new Error('nextVersion returned no row');
    return next;
  }
}
