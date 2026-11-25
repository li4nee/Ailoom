// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { ExtractionWarning } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { DocumentVersionEntity } from './entities/document-version.entity';

/** Extracted revisions of a document. Raw SQL only for the cross-row statements below. */
@Injectable()
export class VersionsRepository {
  constructor(private readonly ds: DataSource) {}

  async findById(
    workspaceId: WorkspaceId,
    versionId: string,
    manager?: EntityManager,
  ): Promise<DocumentVersionEntity | null> {
    const repository = manager ?? this.ds.manager;
    return repository
      .getRepository(DocumentVersionEntity)
      .findOne({ where: { id: versionId, workspaceId } });
  }

  /** The version the retrieval query and the viewer read. */
  async findCurrent(
    workspaceId: WorkspaceId,
    documentId: string,
    manager?: EntityManager,
  ): Promise<DocumentVersionEntity | null> {
    const repository = manager ?? this.ds.manager;
    return repository
      .getRepository(DocumentVersionEntity)
      .createQueryBuilder('v')
      .innerJoin('documents', 'd', 'd.current_version_id = v.id')
      .where('v.workspace_id = :workspaceId', { workspaceId })
      .andWhere('d.id = :documentId', { documentId })
      .andWhere('v.document_id = :documentId', { documentId })
      .getOne();
  }

  /**
   * The newest version of a document, current or not. `recordContent` compares against this:
   * a job retried after a failure before the swap must reuse the version it already wrote.
   */
  async findLatest(
    workspaceId: WorkspaceId,
    documentId: string,
    manager?: EntityManager,
  ): Promise<DocumentVersionEntity | null> {
    const repository = manager ?? this.ds.manager;
    return repository.getRepository(DocumentVersionEntity).findOne({
      where: { workspaceId, documentId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  /** Version history, newest first, scoped through the owning document and workspace. */
  async listForDocument(
    workspaceId: WorkspaceId,
    documentId: string,
  ): Promise<
    {
      id: string;
      createdAt: Date;
      contentHash: string;
      editedBy: { id: string; name: string } | null;
      isCurrent: boolean;
    }[]
  > {
    return this.ds
      .query(
        `SELECT v.id, v.created_at, v.content_hash, v.edited_by,
              u.name AS editor_name, (d.current_version_id = v.id) AS is_current
         FROM document_versions v
         JOIN documents d ON d.workspace_id = v.workspace_id AND d.id = v.document_id
         LEFT JOIN users u ON u.id = v.edited_by
        WHERE v.workspace_id = $1 AND v.document_id = $2
        ORDER BY v.created_at DESC, v.id DESC`,
        [workspaceId, documentId],
      )
      .then(
        (
          rows: {
            id: string;
            created_at: Date;
            content_hash: string;
            edited_by: string | null;
            editor_name: string | null;
            is_current: boolean;
          }[],
        ) =>
          rows.map((row) => ({
            id: row.id,
            createdAt: row.created_at,
            contentHash: row.content_hash,
            editedBy:
              row.edited_by === null
                ? null
                : { id: row.edited_by, name: row.editor_name ?? 'Former user' },
            isCurrent: row.is_current,
          })),
      );
  }

  /** Both versions must belong to the requested document or neither is returned. */
  async findPairForDocument(
    workspaceId: WorkspaceId,
    documentId: string,
    fromId: string,
    toId: string,
  ): Promise<{ from: DocumentVersionEntity; to: DocumentVersionEntity } | null> {
    const rows = await this.ds.getRepository(DocumentVersionEntity).find({
      where: [
        { workspaceId, documentId, id: fromId },
        { workspaceId, documentId, id: toId },
      ],
    });
    const from = rows.find((row) => row.id === fromId);
    const to = rows.find((row) => row.id === toId);
    return from === undefined || to === undefined ? null : { from, to };
  }

  async insert(
    manager: EntityManager,
    version: {
      workspaceId: WorkspaceId;
      documentId: string;
      contentHash: string;
      content: string;
      warnings: ExtractionWarning[];
      editedBy?: string | null;
    },
  ): Promise<DocumentVersionEntity> {
    const repository = manager.getRepository(DocumentVersionEntity);
    const result = await repository.insert({
      workspaceId: version.workspaceId,
      documentId: version.documentId,
      contentHash: version.contentHash,
      content: version.content,
      warnings: version.warnings,
      editedBy: version.editedBy ?? null,
    });
    const id = (result.identifiers[0] as { id?: string } | undefined)?.id;
    if (id === undefined) throw new Error('The document_versions insert returned no id.');
    const row = await repository.findOne({ where: { id, workspaceId: version.workspaceId } });
    if (row === null) throw new Error('The inserted document version could not be read back.');
    return row;
  }

  /** Points the document at `versionId`; the caller deletes the chunks of older versions. */
  async setCurrent(
    manager: EntityManager,
    workspaceId: WorkspaceId,
    documentId: string,
    versionId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE documents SET current_version_id = $3, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, documentId, versionId],
    );
  }

  /** Number of versions a document has; the versioning test asserts a new one per change. */
  async countForDocument(workspaceId: WorkspaceId, documentId: string): Promise<number> {
    const rows = await this.ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM document_versions
        WHERE workspace_id = $1 AND document_id = $2`,
      [workspaceId, documentId],
    );
    return rows[0]?.count ?? 0;
  }
}
