// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import type { ExtractionWarning } from '@app/shared';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { UserEntity } from '../../auth';
import { WorkspaceEntity } from '../../workspaces';
import { DocumentEntity } from './document.entity';

/** One extracted, normalized revision of a document (spec §9.3). */
@Entity({ name: 'document_versions' })
@Index('document_versions_workspace_id', ['workspaceId'])
@Index('document_versions_document_id', ['documentId'])
export class DocumentVersionEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'document_versions_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  documentId!: string;

  @ManyToOne(() => DocumentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'document_id',
    foreignKeyConstraintName: 'document_versions_document_id_fkey',
  })
  document!: DocumentEntity;

  /** SHA-256 of the normalized text; unchanged content skips re-embedding. */
  @Column({ type: 'text' })
  contentHash!: string;

  /** Normalized markdown. */
  @Column({ type: 'text' })
  content!: string;

  /** Extraction warnings (spec §12.3), values of `EXTRACTION_WARNINGS`. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  warnings!: ExtractionWarning[];

  /** Phase 2 manual editor. */
  @Column({ type: 'uuid', nullable: true })
  editedBy!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'edited_by', foreignKeyConstraintName: 'document_versions_edited_by_fkey' })
  editedByUser!: UserEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
