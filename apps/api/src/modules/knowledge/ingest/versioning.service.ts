// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { WorkspaceId } from '../../../db/ids';
import { notifyWorkspace } from '../../realtime';
import { ChunksRepository } from '../chunks.repository';
import { DocumentsRepository } from '../documents.repository';
import { contentHash } from '../domain/content-hash';
import { normalizeMarkdown } from '../domain/normalize';
import type { ExtractResult } from '../extract';
import { VersionsRepository } from '../versions.repository';

export type RecordResult = { changed: false } | { changed: true; versionId: string };

/**
 * Turns an extraction into a document version (spec §12.2). Content is normalized and hashed
 * first: an unchanged resync stops here, so it neither re-chunks nor re-embeds anything.
 */
@Injectable()
export class VersioningService {
  constructor(
    private readonly ds: DataSource,
    private readonly documents: DocumentsRepository,
    private readonly versions: VersionsRepository,
    private readonly chunks: ChunksRepository,
  ) {}

  async recordContent(
    workspaceId: WorkspaceId,
    documentId: string,
    extract: ExtractResult,
  ): Promise<RecordResult> {
    const content = normalizeMarkdown(extract.markdown);
    const hash = contentHash(content);

    const latest = await this.versions.findLatest(workspaceId, documentId);
    if (latest !== null && latest.contentHash === hash) return { changed: false };

    const version = await this.versions.insert(this.ds.manager, {
      workspaceId,
      documentId,
      contentHash: hash,
      content,
      warnings: extract.warnings,
    });
    return { changed: true, versionId: version.id };
  }

  /**
   * Makes `versionId` the searchable revision (spec §12.2): the document points at it and the
   * chunks of older revisions are deleted, in one transaction, then the workspace is notified.
   *
   * The caller has just written rows for the model it is swapping in; the delete still covers
   * every model, because no model can serve a version that is no longer current.
   */
  async swapCurrentVersion(
    workspaceId: WorkspaceId,
    documentId: string,
    versionId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const run = async (active: EntityManager): Promise<void> => {
      await this.versions.setCurrent(active, workspaceId, documentId, versionId);
      const document = await this.documents.findById(workspaceId, documentId, active);
      if (document === null) return;
      await this.chunks.deleteForOldVersions(active, workspaceId, documentId, versionId);
      await notifyWorkspace(active, workspaceId, {
        type: 'source.updated',
        sourceId: document.sourceId,
        botId: document.botId,
        status: 'processing',
      });
    };
    if (manager !== undefined) {
      await run(manager);
      return;
    }
    await this.ds.transaction(run);
  }
}
