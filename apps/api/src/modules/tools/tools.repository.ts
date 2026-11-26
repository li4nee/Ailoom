// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { Sealed } from '../../common/crypto';
import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { BotToolEntity } from './bot-tool.entity';
import { ToolInvocationEntity, type ToolInvocationStatus } from './tool-invocation.entity';

export interface NewToolInvocation {
  id: string;
  workspaceId: WorkspaceId;
  botId: string;
  toolId: string;
  toolVersion: number;
  conversationId: string | null;
  turnId: string;
  traceId: string | null;
  name: string;
  inputFields: string[];
  outputFields: string[];
  status: ToolInvocationStatus;
  errorCode: string | null;
  startedAt: Date;
}

export interface ToolAuthSecret extends Sealed {
  headerName: string;
}

@Injectable()
export class ToolsRepository extends TenantRepository<BotToolEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(BotToolEntity));
  }

  listForBot(workspaceId: WorkspaceId, botId: string): Promise<BotToolEntity[]> {
    return this.ds.getRepository(BotToolEntity).find({
      where: { workspaceId, botId },
      order: { createdAt: 'ASC' },
    });
  }

  versionForUpdate(workspaceId: WorkspaceId, toolId: string, manager: EntityManager) {
    return manager.getRepository(BotToolEntity).findOne({
      where: { workspaceId, id: toolId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async insertVersion(
    workspaceId: WorkspaceId,
    botId: string,
    toolId: string,
    version: number,
    definition: Record<string, unknown>,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO bot_tool_versions (workspace_id, bot_id, tool_id, version, definition)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [workspaceId, botId, toolId, version, JSON.stringify(definition)],
    );
  }

  async insertAuthSecret(
    workspaceId: WorkspaceId,
    toolId: string,
    version: number,
    headerName: string,
    sealed: Sealed,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO bot_tool_auth_secrets
         (workspace_id, tool_id, version, header_name, ciphertext, iv, tag, key_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        workspaceId,
        toolId,
        version,
        headerName,
        sealed.ciphertext,
        sealed.iv,
        sealed.tag,
        sealed.keyVersion,
      ],
    );
  }

  async getAuthSecret(
    workspaceId: WorkspaceId,
    toolId: string,
    version: number,
    manager?: EntityManager,
  ): Promise<ToolAuthSecret | null> {
    const query = `SELECT header_name, ciphertext, iv, tag, key_version
                     FROM bot_tool_auth_secrets
                    WHERE workspace_id = $1 AND tool_id = $2 AND version = $3`;
    const params = [workspaceId, toolId, version];
    const rows = await (manager ?? this.ds).query<
      {
        header_name: string;
        ciphertext: Buffer;
        iv: Buffer;
        tag: Buffer;
        key_version: number;
      }[]
    >(query, params);
    const row = rows[0];
    return row === undefined
      ? null
      : {
          headerName: row.header_name,
          ciphertext: row.ciphertext,
          iv: row.iv,
          tag: row.tag,
          keyVersion: row.key_version,
        };
  }

  findByName(workspaceId: WorkspaceId, botId: string, name: string): Promise<BotToolEntity | null> {
    return this.ds.getRepository(BotToolEntity).findOne({ where: { workspaceId, botId, name } });
  }

  async insertInvocation(input: NewToolInvocation): Promise<void> {
    await this.ds.getRepository(ToolInvocationEntity).insert(input);
  }

  async finishInvocation(
    workspaceId: WorkspaceId,
    id: string,
    result: {
      outputFields: string[];
      status: Exclude<ToolInvocationStatus, 'started'>;
      durationMs: number;
      errorCode?: string;
    },
  ): Promise<void> {
    await this.ds.getRepository(ToolInvocationEntity).update(
      { workspaceId, id },
      {
        ...result,
        completedAt: new Date(),
      },
    );
  }

  async deleteInvocationsOlderThan(cutoff: Date): Promise<number> {
    const batchSize = 5_000;
    let deleted = 0;
    let hasMore = true;
    while (hasMore) {
      const rows = await this.ds.query<{ id: string }[]>(
        `WITH expired AS (
           SELECT id FROM tool_invocations
            WHERE created_at < $1
            ORDER BY created_at
            LIMIT $2
         )
         DELETE FROM tool_invocations ti
          USING expired
          WHERE ti.id = expired.id
          RETURNING ti.id`,
        [cutoff, batchSize],
      );
      deleted += rows.length;
      hasMore = rows.length === batchSize;
    }
    return deleted;
  }
}
