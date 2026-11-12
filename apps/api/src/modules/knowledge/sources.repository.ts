// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { KnowledgeSourceEntity } from './entities/knowledge-source.entity';

@Injectable()
export class SourcesRepository extends TenantRepository<KnowledgeSourceEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(KnowledgeSourceEntity));
  }

  /** Oldest first, so a source added last appears at the end of the admin list. */
  async listForBot(workspaceId: WorkspaceId, botId: string): Promise<KnowledgeSourceEntity[]> {
    return this.ds
      .getRepository(KnowledgeSourceEntity)
      .find({ where: { workspaceId, botId }, order: { createdAt: 'ASC' } });
  }

  /** A source of one bot; a source of another bot is not found, even in the same workspace. */
  async findForBot(
    workspaceId: WorkspaceId,
    botId: string,
    sourceId: string,
    manager?: EntityManager,
  ): Promise<KnowledgeSourceEntity | null> {
    const row = await this.findById(workspaceId, sourceId, manager);
    return row?.botId === botId ? row : null;
  }

  /**
   * The metadata row of an uploaded blob. Raw SQL because `files` has no tenant repository of
   * its own: the row is only ever written here, together with the source that points at it.
   */
  async insertFile(
    manager: EntityManager,
    file: {
      workspaceId: WorkspaceId;
      storageKey: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
    },
  ): Promise<string> {
    const rows = await manager.query<{ id: string }[]>(
      `INSERT INTO files (workspace_id, storage_key, filename, mime_type, size_bytes, sha256)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        file.workspaceId,
        file.storageKey,
        file.filename,
        file.mimeType,
        file.sizeBytes,
        file.sha256,
      ],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('The files insert did not return an id.');
    return id;
  }

  /** The storage key of a file row, so a purge can delete the blob it names. */
  async findFileKey(workspaceId: WorkspaceId, fileId: string): Promise<string | null> {
    const rows = await this.ds.query<{ storage_key: string }[]>(
      `SELECT storage_key FROM files WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, fileId],
    );
    return rows[0]?.storage_key ?? null;
  }

  /**
   * Raw SQL because the progress counters must not bump `updated_at`: the admin sorts by
   * name and shows a live status, and a counter write is not an edit. The caller passes the
   * manager so a rollback also undoes the counters.
   */
  async setStatus(
    manager: EntityManager,
    workspaceId: WorkspaceId,
    sourceId: string,
    status: KnowledgeSourceEntity['status'],
    error: string | null = null,
  ): Promise<void> {
    await manager.query(
      `UPDATE knowledge_sources
          SET status = $3, error = $4
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, sourceId, status, error],
    );
  }

  /**
   * True while a job for this source is queued or running. Raw SQL because pg-boss owns its
   * schema and exposes no "is queued" lookup; the payload column is read by key, not matched
   * with a LIKE, so a source id cannot collide with another one.
   */
  async hasActiveJob(manager: EntityManager, jobName: string, sourceId: string): Promise<boolean> {
    const rows = await manager.query<{ one: number }[]>(
      `SELECT 1 AS one FROM pgboss.job
        WHERE name = $1 AND state IN ('created', 'retry', 'active')
          AND data->>'sourceId' = $2
        LIMIT 1`,
      [jobName, sourceId],
    );
    return rows.length > 0;
  }

  /** Resets the progress counters when a source starts over. */
  async resetProgress(
    manager: EntityManager,
    workspaceId: WorkspaceId,
    sourceId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE knowledge_sources
          SET pages_total = 0, pages_done = 0, pages_failed = 0, warning_count = 0
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, sourceId],
    );
  }
}
