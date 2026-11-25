// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { Page } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { encodeCursor } from '../../db/pagination';
import { TenantRepository } from '../../db/tenant.repository';
import type { DocumentVersionEntity } from './entities/document-version.entity';
import { DocumentEntity } from './entities/document.entity';

/** One page or file of a source. Every write is workspace-scoped through `TenantRepository`. */
@Injectable()
export class DocumentsRepository extends TenantRepository<DocumentEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(DocumentEntity));
  }

  /** A document of one bot; another bot's document is not found, even in the same workspace. */
  async findForBot(
    workspaceId: WorkspaceId,
    botId: string,
    documentId: string,
    manager?: EntityManager,
  ): Promise<DocumentEntity | null> {
    const row = await this.findById(workspaceId, documentId, manager);
    return row?.botId === botId ? row : null;
  }

  /** Newest first, cursor-paginated, for the document list of a source. */
  async listForSource(
    workspaceId: WorkspaceId,
    sourceId: string,
    options: { limit: number; cursor: string | null },
  ): Promise<Page<DocumentEntity>> {
    return this.list(workspaceId, { ...options, where: { sourceId } });
  }

  /**
   * One page of a source's documents with the chunk count and warnings of the current version.
   * Raw SQL because the count lives in `chunks` and the warnings on the joined version.
   */
  async listSummariesForSource(
    workspaceId: WorkspaceId,
    sourceId: string,
    options: { limit: number; cursor: string | null },
  ): Promise<
    Page<{
      id: string;
      url: string | null;
      title: string | null;
      status: DocumentEntity['status'];
      warnings: DocumentVersionEntity['warnings'];
      chunkCount: number;
      lastSyncedAt: Date | null;
      lastCheckedAt: Date | null;
      unreachableSince: Date | null;
    }>
  > {
    const rows = await this.ds.query<
      {
        id: string;
        url: string | null;
        title: string | null;
        status: DocumentEntity['status'];
        warnings: DocumentVersionEntity['warnings'] | null;
        chunk_count: number;
        last_synced_at: Date | null;
        last_checked_at: Date | null;
        unreachable_since: Date | null;
      }[]
    >(
      `SELECT d.id, d.url, d.title, d.status, d.last_checked_at, d.unreachable_since,
              v.warnings, v.created_at AS last_synced_at,
              (SELECT count(*)::int FROM chunks c WHERE c.document_version_id = d.current_version_id)
                AS chunk_count
         FROM documents d
         LEFT JOIN document_versions v ON v.id = d.current_version_id
        WHERE d.workspace_id = $1 AND d.source_id = $2
          AND ($3::uuid IS NULL OR d.id < $3)
        ORDER BY d.id DESC
        LIMIT $4`,
      [workspaceId, sourceId, options.cursor, options.limit + 1],
    );
    const data = rows.slice(0, options.limit).map((row) => ({
      id: row.id,
      url: row.url,
      title: row.title,
      status: row.status,
      warnings: row.warnings ?? [],
      chunkCount: row.chunk_count,
      lastSyncedAt: row.last_synced_at,
      lastCheckedAt: row.last_checked_at,
      unreachableSince: row.unreachable_since,
    }));
    const last = data.at(-1);
    return {
      data,
      nextCursor: rows.length > options.limit && last !== undefined ? encodeCursor(last.id) : null,
    };
  }

  /** A canonical URL already indexed by this source: the same page runs once, not twice. */
  async findByUrl(
    workspaceId: WorkspaceId,
    sourceId: string,
    url: string,
    manager?: EntityManager,
  ): Promise<DocumentEntity | null> {
    const repository = manager ?? this.ds.manager;
    return repository.getRepository(DocumentEntity).findOne({
      where: { workspaceId, sourceId, url },
    });
  }

  /**
   * `INSERT … ON CONFLICT DO NOTHING` on `(source_id, url)`: two `ingest.page` jobs for the
   * same canonical URL (a retry racing a duplicate) cannot create two documents.
   */
  async insertIfNew(
    manager: EntityManager,
    document: {
      workspaceId: WorkspaceId;
      botId: string;
      sourceId: string;
      url: string | null;
      title: string | null;
    },
  ): Promise<{ id: string; created: boolean }> {
    const rows = await manager.query<{ id: string }[]>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, url, title)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [document.workspaceId, document.botId, document.sourceId, document.url, document.title],
    );
    const created = rows[0]?.id;
    if (created !== undefined) return { id: created, created: true };
    if (document.url === null) throw new Error('A document without a URL already exists.');
    const existing = await this.findByUrl(
      document.workspaceId,
      document.sourceId,
      document.url,
      manager,
    );
    if (existing === null) throw new Error('The documents insert conflicted with an unknown row.');
    return { id: existing.id, created: false };
  }

  /**
   * The one document a text or file source owns. A resync reuses it instead of appending a
   * second copy; the URL-less row is the source itself, not a page.
   */
  async upsertRoot(
    manager: EntityManager,
    document: {
      workspaceId: WorkspaceId;
      botId: string;
      sourceId: string;
      title: string;
    },
  ): Promise<string> {
    const existing = await manager.query<{ id: string }[]>(
      `SELECT id FROM documents
        WHERE workspace_id = $1 AND source_id = $2 AND url IS NULL
        ORDER BY id LIMIT 1`,
      [document.workspaceId, document.sourceId],
    );
    const found = existing[0]?.id;
    if (found !== undefined) return found;
    const inserted = await manager.query<{ id: string }[]>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, url, title)
       VALUES ($1, $2, $3, NULL, $4) RETURNING id`,
      [document.workspaceId, document.botId, document.sourceId, document.title],
    );
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error('The documents insert returned no id.');
    return id;
  }

  async setTitle(
    manager: EntityManager,
    workspaceId: WorkspaceId,
    documentId: string,
    title: string | null,
  ): Promise<void> {
    if (title === null || title.trim() === '') return;
    await manager.query(`UPDATE documents SET title = $3 WHERE workspace_id = $1 AND id = $2`, [
      workspaceId,
      documentId,
      title.slice(0, 500),
    ]);
  }

  /** The document a chunk/embedding job names, through its version. */
  async findByVersionId(
    workspaceId: WorkspaceId,
    versionId: string,
    manager?: EntityManager,
  ): Promise<DocumentEntity | null> {
    const rows = await (manager ?? this.ds.manager).query<{ document_id: string }[]>(
      `SELECT document_id FROM document_versions WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, versionId],
    );
    const documentId = rows[0]?.document_id;
    return documentId === undefined ? null : this.findById(workspaceId, documentId, manager);
  }

  /** Number of documents a source has, for the admin list. */
  async countForSource(workspaceId: WorkspaceId, sourceId: string): Promise<number> {
    const rows = await this.ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM documents WHERE workspace_id = $1 AND source_id = $2`,
      [workspaceId, sourceId],
    );
    return rows[0]?.count ?? 0;
  }

  /** A successful check restores a formerly unreachable page and records the check time. */
  async markChecked(
    workspaceId: WorkspaceId,
    documentId: string,
    checkedAt: Date,
    manager?: EntityManager,
  ): Promise<void> {
    // Raw SQL updates the freshness fields together without changing source-level progress.
    await (manager ?? this.ds.manager).query(
      `UPDATE documents
          SET status = 'active', last_checked_at = $3, unreachable_since = NULL,
              updated_at = now()
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, documentId, checkedAt],
    );
  }

  /** A failed recrawl preserves the current version and only changes freshness state. */
  async markUnreachable(
    workspaceId: WorkspaceId,
    documentId: string,
    checkedAt: Date,
    manager?: EntityManager,
  ): Promise<void> {
    // Keep the existing unreachable_since so repeated failures describe one outage interval.
    await (manager ?? this.ds.manager).query(
      `UPDATE documents
          SET status = 'unreachable', last_checked_at = $3,
              unreachable_since = COALESCE(unreachable_since, $3), updated_at = now()
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, documentId, checkedAt],
    );
  }

  /**
   * Removes stale sitemap pages from retrieval without deleting their version history. The
   * document/source/workspace predicates keep this write tenant-scoped.
   */
  async markMissingSitemapPagesRemoved(
    workspaceId: WorkspaceId,
    sourceId: string,
    currentUrls: string[],
    manager: EntityManager,
  ): Promise<number> {
    const result: unknown = await manager.query(
      `UPDATE documents
          SET status = 'removed', current_version_id = NULL, unreachable_since = NULL,
              updated_at = now()
        WHERE workspace_id = $1 AND source_id = $2 AND url IS NOT NULL
          AND NOT (url = ANY($3::text[]))
        RETURNING id`,
      [workspaceId, sourceId, currentUrls],
    );
    const outer = result as unknown[];
    const rows = (Array.isArray(outer[0]) ? outer[0] : outer) as { id: string }[];
    return rows.length;
  }
}
