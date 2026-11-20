// SPDX-License-Identifier: AGPL-3.0-only
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { UserEntity } from '../../auth';
import { WorkspaceEntity } from '../../workspaces';
import { ConversationEntity } from './conversation.entity';

@Entity({ name: 'conversation_internal_notes' })
@Check('conversation_internal_notes_body_length', '"body" IS NULL OR char_length("body") <= 4000')
@Check('conversation_internal_notes_version_check', '"version" >= 1')
@Index('conversation_internal_notes_timeline', ['workspaceId', 'conversationId', 'createdAt', 'id'])
export class InternalNoteEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'conversation_internal_notes_workspace_fkey',
  })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  conversationId!: string;

  @ManyToOne(() => ConversationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'conversation_id',
    foreignKeyConstraintName: 'conversation_internal_notes_conversation_fkey',
  })
  conversation!: ConversationEntity;

  @Column({ type: 'uuid', nullable: true })
  authorUserId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'author_user_id',
    foreignKeyConstraintName: 'conversation_internal_notes_author_fkey',
  })
  author!: UserEntity | null;

  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  deletedByUserId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'deleted_by_user_id',
    foreignKeyConstraintName: 'conversation_internal_notes_deleted_by_fkey',
  })
  deletedBy!: UserEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
