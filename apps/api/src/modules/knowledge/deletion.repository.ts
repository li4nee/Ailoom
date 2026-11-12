// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';

/** Spec §12.8: delete in batches so a large crawl never holds one huge transaction. */
export const DELETE_BATCH_SIZE = 1_000;

/**
 * The destructive half of source deletion. Raw SQL because every statement is a set operation
 * over three tables and a batch limit; TypeORM has no repository call that expresses it.
 */
@Injectable()
export class DeletionRepository {
  constructor(private readonly ds: DataSource) {}

  /** Blobs to remove, from the `files` row the source names and its own `file_key`. */
  async storageKeysForSource(
    workspaceId: WorkspaceId,
    sourceId: string,
    fileId: string | null,
    fileKey: string | null,
  ): Promise<string[]> {
    const rows = await this.ds.query<{ storage_key: string }[]>(
      `SELECT storage_key FROM files
        WHERE workspace_id = $1 AND (($2::uuid IS NOT NULL AND id = $2) OR storage_key = $3)`,
      [workspaceId, fileId, fileKey],
    );
    return rows.map((row) => row.storage_key);
  }

  async deleteChunksBatch(
    workspaceId: WorkspaceId,
    sourceId: string,
    limit: number,
  ): Promise<number> {
    return this.deleteBatch(
      `DELETE FROM chunks WHERE id IN (
         SELECT c.id FROM chunks c
           JOIN document_versions v ON v.id = c.document_version_id
           JOIN documents d ON d.id = v.document_id
          WHERE c.workspace_id = $1 AND d.source_id = $2
          LIMIT $3)`,
      workspaceId,
      sourceId,
      limit,
    );
  }

  async deleteVersionsBatch(
    workspaceId: WorkspaceId,
    sourceId: string,
    limit: number,
  ): Promise<number> {
    return this.deleteBatch(
      `DELETE FROM document_versions WHERE id IN (
         SELECT v.id FROM document_versions v
           JOIN documents d ON d.id = v.document_id
          WHERE v.workspace_id = $1 AND d.source_id = $2
          LIMIT $3)`,
      workspaceId,
      sourceId,
      limit,
    );
  }

  async deleteDocumentsBatch(
    workspaceId: WorkspaceId,
    sourceId: string,
    limit: number,
  ): Promise<number> {
    return this.deleteBatch(
      `DELETE FROM documents WHERE id IN (
         SELECT id FROM documents WHERE workspace_id = $1 AND source_id = $2 LIMIT $3)`,
      workspaceId,
      sourceId,
      limit,
    );
  }

  /**
   * Removes the metadata rows of the source's uploads. The blob is deleted before this, because
   * the storage key exists only here (see the workspace purge).
   */
  async deleteFileRows(
    workspaceId: WorkspaceId,
    sourceId: string,
    fileId: string | null,
    fileKey: string | null,
  ): Promise<void> {
    await this.ds.query(
      `DELETE FROM files
        WHERE workspace_id = $1 AND (($2::uuid IS NOT NULL AND id = $2) OR storage_key = $3)`,
      [workspaceId, fileId, fileKey],
    );
  }

  async deleteSource(workspaceId: WorkspaceId, sourceId: string): Promise<void> {
    await this.ds.query(`DELETE FROM knowledge_sources WHERE workspace_id = $1 AND id = $2`, [
      workspaceId,
      sourceId,
    ]);
  }

  async listSourceIdsForBot(
    workspaceId: WorkspaceId,
    botId: string,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.ds.query<{ id: string }[]>(
      `SELECT id FROM knowledge_sources WHERE workspace_id = $1 AND bot_id = $2 LIMIT $3`,
      [workspaceId, botId, limit],
    );
    return rows.map((row) => row.id);
  }

  /** A DELETE's affected count is the second element TypeORM returns, not a row. */
  private async deleteBatch(
    sql: string,
    workspaceId: WorkspaceId,
    sourceId: string,
    limit: number,
  ): Promise<number> {
    const result: unknown = await this.ds.query(sql, [workspaceId, sourceId, limit]);
    const tuple = result as unknown[];
    const affected = Array.isArray(tuple) ? tuple[1] : undefined;
    return typeof affected === 'number' ? affected : 0;
  }
}
