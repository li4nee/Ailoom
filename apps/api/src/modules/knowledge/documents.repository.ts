// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { Page } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
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

  /** Number of documents a source has, for the admin list. */
  async countForSource(workspaceId: WorkspaceId, sourceId: string): Promise<number> {
    const rows = await this.ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM documents WHERE workspace_id = $1 AND source_id = $2`,
      [workspaceId, sourceId],
    );
    return rows[0]?.count ?? 0;
  }
}
