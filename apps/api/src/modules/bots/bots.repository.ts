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
   * A bot by its widget key that is safe to serve a widget request: neither the bot nor its
   * workspace is soft-deleted (spec §10.4).
   */
  async findLiveByPublicKey(publicKey: string): Promise<BotEntity | null> {
    return this.ds.getRepository(BotEntity).findOne({
      where: { publicKey, deletedAt: IsNull(), workspace: { deletedAt: IsNull() } },
      relations: { workspace: true },
    });
  }

  /**
   * The bot a visitor token points at, safe to serve: the token binds bot and workspace ids,
   * and neither row may be soft-deleted (spec §10.4).
   */
  async findLiveForVisitor(workspaceId: WorkspaceId, botId: string): Promise<BotEntity | null> {
    return this.ds.getRepository(BotEntity).findOne({
      where: { id: botId, workspaceId, deletedAt: IsNull(), workspace: { deletedAt: IsNull() } },
      relations: { workspace: true },
    });
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

  /** True while the bot and its workspace still exist; false once either was deleted. */
  async existsLive(workspaceId: WorkspaceId, botId: string): Promise<boolean> {
    const rows = await this.ds.query<{ id: string }[]>(
      `SELECT b.id
         FROM bots b
         JOIN workspaces w ON w.id = b.workspace_id
        WHERE b.id = $1 AND b.workspace_id = $2 AND b.deleted_at IS NULL
        LIMIT 1`,
      [botId, workspaceId],
    );
    return rows.length > 0;
  }

  /** The provider of a credential, for pricing a chat call. Raw SQL, like `countChunks`. */
  async credentialProvider(credentialId: string): Promise<string | null> {
    const rows = await this.ds.query<{ provider: string }[]>(
      `SELECT provider FROM provider_credentials WHERE id = $1`,
      [credentialId],
    );
    return rows[0]?.provider ?? null;
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

  /**
   * Spec §12.7: a direct change supersedes a pending re-embed. Bumping the generation tells a
   * running job to stop before its next batch, and clearing the pending columns keeps that job
   * from later swapping the bot back to the superseded model. Raw SQL because it increments a
   * column and must be one statement.
   */
  async clearReembedPending(
    manager: EntityManager,
    workspaceId: WorkspaceId,
    botId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE bots
          SET pending_embedding_model = NULL,
              pending_embedding_credential_id = NULL,
              pending_embedding_dim = NULL,
              reembed_generation = reembed_generation + 1,
              last_error = NULL,
              updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [workspaceId, botId],
    );
  }

  /**
   * Spec §12.7: a new embedding model becomes pending and the generation bumps, which tells a
   * running re-embed to stop. Raw SQL because it increments a column and returns it atomically.
   */
  async markReembedPending(
    manager: EntityManager,
    input: {
      workspaceId: WorkspaceId;
      botId: string;
      model: string;
      credentialId: string;
      dim: number;
    },
  ): Promise<number> {
    const result: unknown = await manager.query(
      `UPDATE bots
          SET pending_embedding_model = $3,
              pending_embedding_credential_id = $4,
              pending_embedding_dim = $5,
              reembed_generation = reembed_generation + 1,
              last_error = NULL,
              updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING reembed_generation`,
      [input.workspaceId, input.botId, input.model, input.credentialId, input.dim],
    );
    const tuple = result as unknown[];
    const rows = (Array.isArray(tuple) ? tuple[0] : []) as { reembed_generation: number }[];
    const generation = rows[0]?.reembed_generation;
    if (generation === undefined) throw new Error('markReembedPending: the bot does not exist');
    return generation;
  }
}
