// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { DOCUMENT_STATUSES, type DocumentStatus } from '@app/shared';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { BotEntity } from '../../bots';
import { WorkspaceEntity } from '../../workspaces';
import { KnowledgeSourceEntity } from './knowledge-source.entity';

/** One logical page or file within a source (spec §9.3). */
@Entity({ name: 'documents' })
@Index('documents_workspace_id', ['workspaceId'])
@Index('documents_bot_id', ['botId'])
@Index('documents_source_id', ['sourceId'])
@Index('documents_current_version_id', ['currentVersionId'])
export class DocumentEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'documents_workspace_id_fkey' })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  botId!: string;

  @ManyToOne(() => BotEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bot_id', foreignKeyConstraintName: 'documents_bot_id_fkey' })
  bot!: BotEntity;

  @Column({ type: 'uuid' })
  sourceId!: string;

  @ManyToOne(() => KnowledgeSourceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_id', foreignKeyConstraintName: 'documents_source_id_fkey' })
  source!: KnowledgeSourceEntity;

  /** Canonical URL for crawled pages. */
  @Column({ type: 'text', nullable: true })
  url!: string | null;

  @Column({ type: 'text', nullable: true })
  title!: string | null;

  /**
   * Only chunks of this version are searchable. A bare foreign key, with no relation property:
   * versions point back at their document (see BotEntity.activePromptVersionId).
   */
  @ForeignKey('DocumentVersionEntity', {
    name: 'documents_current_version_id_fkey',
    onDelete: 'SET NULL',
  })
  @Column({ type: 'uuid', nullable: true })
  currentVersionId!: string | null;

  /** Phase 2 freshness. */
  @Column({ type: 'enum', enum: DOCUMENT_STATUSES, enumName: 'document_status', default: 'active' })
  status!: DocumentStatus;

  /** Phase 2. */
  @Column({ type: 'timestamptz', nullable: true })
  lastCheckedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
