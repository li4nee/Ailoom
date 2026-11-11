// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { BotEntity } from './bot.entity';

/** Bots of one workspace. Every write is workspace-scoped through `TenantRepository`. */
@Injectable()
export class BotsRepository extends TenantRepository<BotEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(BotEntity));
  }

  /** Oldest first, so a new bot appears at the end of the admin list. Never deleted rows. */
  async listLive(workspaceId: WorkspaceId): Promise<BotEntity[]> {
    return this.ds
      .getRepository(BotEntity)
      .find({ where: { workspaceId, deletedAt: IsNull() }, order: { createdAt: 'ASC' } });
  }

  /**
   * A bot by its widget key, across every workspace: the widget request carries only that key,
   * and `public_key` is unique instance-wide. Soft-deleted bots never resolve.
   */
  async findByPublicKey(publicKey: string): Promise<BotEntity | null> {
    return this.ds.getRepository(BotEntity).findOne({ where: { publicKey, deletedAt: IsNull() } });
  }

  /**
   * Raw SQL: `chunks` belongs to the knowledge module, which imports this one for the bot
   * entity, so reading it through an entity import here would close a cycle.
   */
  async countChunks(workspaceId: WorkspaceId, botId: string): Promise<number> {
    const rows = await this.ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM chunks WHERE workspace_id = $1 AND bot_id = $2`,
      [workspaceId, botId],
    );
    return rows[0]?.count ?? 0;
  }
}
