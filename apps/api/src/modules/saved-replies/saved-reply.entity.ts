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

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { UserEntity } from '../auth';
import { WorkspaceEntity } from '../workspaces';

@Entity({ name: 'saved_replies' })
@Index('saved_replies_workspace_order', [
  'workspaceId',
  'archivedAt',
  'sortOrder',
  'normalizedTitle',
  'id',
])
@Index('saved_replies_workspace_active_title', ['workspaceId', 'normalizedTitle'], {
  unique: true,
  where: '"archived_at" IS NULL',
})
export class SavedReplyEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'saved_replies_workspace_id_fkey' })
  workspace!: WorkspaceEntity;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'text' })
  normalizedTitle!: string;

  @Column({ type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'saved_replies_created_by_fkey' })
  creator!: UserEntity | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'updated_by', foreignKeyConstraintName: 'saved_replies_updated_by_fkey' })
  updater!: UserEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
