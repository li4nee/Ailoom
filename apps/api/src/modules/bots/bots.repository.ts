// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';

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
   * The empty first prompt version a new bot starts with, so the editor always has a row to
   * show and `active_prompt_version_id` is never dangling. Raw SQL because `prompt_versions`
   * belongs to the prompts module, which imports this one for the bot row: an entity import
   * here would close a cycle.
   */
  async insertInitialPromptVersion(
    workspaceId: WorkspaceId,
    botId: string,
    manager: EntityManager,
  ): Promise<string> {
    const rows: unknown = await manager.query(
      `INSERT INTO prompt_versions (workspace_id, bot_id, version, system_prompt)
       VALUES ($1, $2, 1, '')
       RETURNING id`,
      [workspaceId, botId],
    );
    const id = (rows as { id: string }[])[0]?.id;
    if (id === undefined) throw new Error('insertInitialPromptVersion returned no id');
    return id;
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
