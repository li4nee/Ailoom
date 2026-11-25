// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  SOURCE_STATUSES,
  SOURCE_TYPES,
  type RecrawlInterval,
  type SourceStatus,
  type SourceType,
} from '@app/shared';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { BotEntity } from '../../bots';
import { WorkspaceEntity } from '../../workspaces';

/** What the user added to a bot's knowledge (spec §9.3). */
@Entity({ name: 'knowledge_sources' })
@Index('knowledge_sources_workspace_id', ['workspaceId'])
@Index('knowledge_sources_bot_id', ['botId'])
@Index('knowledge_sources_recrawl_due_idx', { synchronize: false })
export class KnowledgeSourceEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'knowledge_sources_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  botId!: string;

  @ManyToOne(() => BotEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bot_id', foreignKeyConstraintName: 'knowledge_sources_bot_id_fkey' })
  bot!: BotEntity;

  @Column({ type: 'enum', enum: SOURCE_TYPES, enumName: 'source_type' })
  type!: SourceType;

  @Column({ type: 'text' })
  title!: string;

  /** For `url` and `sitemap` sources. */
  @Column({ type: 'text', nullable: true })
  sourceUrl!: string | null;

  /** Storage path for uploads. */
  @Column({ type: 'text', nullable: true })
  fileKey!: string | null;

  @Column({
    type: 'enum',
    enum: SOURCE_STATUSES,
    enumName: 'source_status',
    default: 'pending',
  })
  status!: SourceStatus;

  /** User-facing failure reason. */
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  /** Pages found, finished and failed; the admin shows live progress from these (spec §9.3). */
  @Column({ type: 'int', default: 0 })
  pagesTotal!: number;

  @Column({ type: 'int', default: 0 })
  pagesDone!: number;

  @Column({ type: 'int', default: 0 })
  pagesFailed!: number;

  /** Documents finished with an extraction warning, so the admin can flag a flaky crawl. */
  @Column({ type: 'int', default: 0 })
  warningCount!: number;

  /** Crawl limits, include/exclude patterns. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  options!: Record<string, unknown>;

  /** Phase 2. */
  @Column({ type: 'interval', nullable: true })
  recrawlInterval!: RecrawlInterval | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
