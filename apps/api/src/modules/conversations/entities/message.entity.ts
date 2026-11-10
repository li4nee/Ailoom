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

import { MESSAGE_ROLES, MESSAGE_STATUSES, type MessageRole, type MessageStatus } from '@app/shared';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { UserEntity } from '../../auth';
import { WorkspaceEntity } from '../../workspaces';
import { ConversationEntity } from './conversation.entity';

/** One citation in an AI answer (spec §13.6). */
export interface MessageCitation {
  n: number;
  chunk_id: string;
  document_id: string;
  title: string | null;
  url: string | null;
}

/**
 * A message in a conversation (spec §9.4). `(conversation_id, created_at)` and the GIN index
 * on `tsv` are hand-written, hence `synchronize: false`.
 */
@Entity({ name: 'messages' })
@Index('messages_workspace_id', ['workspaceId'])
@Index('messages_conversation_created', { synchronize: false })
@Index('messages_tsv_gin', { synchronize: false })
export class MessageEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'messages_workspace_id_fkey' })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  conversationId!: string;

  @ManyToOne(() => ConversationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'conversation_id',
    foreignKeyConstraintName: 'messages_conversation_id_fkey',
  })
  conversation!: ConversationEntity;

  @Column({ type: 'enum', enum: MESSAGE_ROLES, enumName: 'message_role' })
  role!: MessageRole;

  /** For agent messages. SET NULL: a deleted user's messages stay, shown as "Deleted user". */
  @Column({ type: 'uuid', nullable: true })
  authorUserId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'author_user_id',
    foreignKeyConstraintName: 'messages_author_user_id_fkey',
  })
  authorUser!: UserEntity | null;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'jsonb', nullable: true })
  citations!: MessageCitation[] | null;

  @Column({ type: 'enum', enum: MESSAGE_STATUSES, enumName: 'message_status', default: 'complete' })
  status!: MessageStatus;

  /** -1, 1, or null (visitor thumbs). */
  @Column({ type: 'smallint', nullable: true })
  feedback!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  feedbackAt!: Date | null;

  /** Phase 2: `{ verdict, corrected_answer, reviewer_id }`. */
  @Column({ type: 'jsonb', nullable: true })
  agentReview!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  /** Conversation search (`?q=`). */
  @Column({
    type: 'tsvector',
    generatedType: 'STORED',
    asExpression: "to_tsvector('simple', content)",
    select: false,
    insert: false,
    update: false,
  })
  tsv!: string;
}
