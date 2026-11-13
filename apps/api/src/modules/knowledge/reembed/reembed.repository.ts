// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { WorkspaceId } from '../../../db/ids';

export interface CurrentDocument {
  documentId: string;
  versionId: string;
  title: string;
}

/**
 * The bot-level statements of a re-embed (spec §12.7). Raw SQL because they touch `chunks`
 * (pgvector) and swap several `bots` columns in one statement.
 */
@Injectable()
export class ReembedRepository {
  constructor(private readonly ds: DataSource) {}

  /** Every document with a current version, with the title a chunk heading should use. */
  async listCurrentDocuments(workspaceId: WorkspaceId, botId: string): Promise<CurrentDocument[]> {
    const rows = await this.ds.query<{ document_id: string; version_id: string; title: string }[]>(
      `SELECT d.id AS document_id, d.current_version_id AS version_id,
              coalesce(d.title, s.title) AS title
         FROM documents d
         JOIN knowledge_sources s ON s.id = d.source_id
        WHERE d.workspace_id = $1 AND d.bot_id = $2 AND d.current_version_id IS NOT NULL
        ORDER BY d.created_at ASC, d.id ASC`,
      [workspaceId, botId],
    );
    return rows.map((row) => ({
      documentId: row.document_id,
      versionId: row.version_id,
      title: row.title,
    }));
  }

  /** The generation a running job compares against: a mismatch means it was superseded. */
  async generation(workspaceId: WorkspaceId, botId: string): Promise<number | null> {
    const rows = await this.ds.query<{ reembed_generation: number }[]>(
      `SELECT reembed_generation FROM bots WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, botId],
    );
    return rows[0]?.reembed_generation ?? null;
  }

  /** Removes the rows one run (or one abandoned generation) wrote; safe when there are none. */
  async deleteChunksForModel(
    manager: EntityManager,
    workspaceId: WorkspaceId,
    botId: string,
    model: string,
  ): Promise<void> {
    await manager.query(
      `DELETE FROM chunks WHERE workspace_id = $1 AND bot_id = $2 AND embedding_model = $3`,
      [workspaceId, botId, model],
    );
  }

  /**
   * The swap: the target becomes the bot's model and every other model's rows are dropped in
   * the same transaction, so retrieval can never see both (spec §12.7 step 3).
   */
  async swap(
    manager: EntityManager,
    input: {
      workspaceId: WorkspaceId;
      botId: string;
      model: string;
      credentialId: string;
      dim: number;
      generation: number;
    },
  ): Promise<boolean> {
    const result: unknown = await manager.query(
      `UPDATE bots
          SET embedding_model = $3,
              embedding_credential_id = $4,
              embedding_dim = $5,
              pending_embedding_model = NULL,
              pending_embedding_credential_id = NULL,
              pending_embedding_dim = NULL,
              last_error = NULL,
              updated_at = now()
        WHERE workspace_id = $1 AND id = $2
          AND reembed_generation = $6
          AND deleted_at IS NULL`,
      [
        input.workspaceId,
        input.botId,
        input.model,
        input.credentialId,
        input.dim,
        input.generation,
      ],
    );
    const tuple = result as unknown[];
    const affected = Array.isArray(tuple) ? tuple[1] : 0;
    if (affected === 0) return false;
    await manager.query(
      `DELETE FROM chunks
        WHERE workspace_id = $1 AND bot_id = $2 AND embedding_model <> $3`,
      [input.workspaceId, input.botId, input.model],
    );
    return true;
  }

  async sources(workspaceId: WorkspaceId, botId: string): Promise<string[]> {
    const rows = await this.ds.query<{ id: string }[]>(
      `SELECT id FROM knowledge_sources WHERE workspace_id = $1 AND bot_id = $2`,
      [workspaceId, botId],
    );
    return rows.map((row) => row.id);
  }

  /** The failure is shown on the bot; the bot itself stays on the old model. */
  async fail(workspaceId: WorkspaceId, botId: string, message: string): Promise<void> {
    await this.ds.query(
      `UPDATE bots
          SET last_error = $3,
              pending_embedding_model = NULL,
              pending_embedding_credential_id = NULL,
              pending_embedding_dim = NULL,
              updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [workspaceId, botId, message],
    );
  }
}
