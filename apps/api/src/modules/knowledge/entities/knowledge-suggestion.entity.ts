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

import { SUGGESTION_STATUSES, type SuggestionStatus } from '@app/shared';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { UserEntity } from '../../auth';
import { BotEntity } from '../../bots';
import { ConversationEntity } from '../../conversations/entities/conversation.entity';
import { MessageEntity } from '../../conversations/entities/message.entity';
import { WorkspaceEntity } from '../../workspaces';
import { KnowledgeSourceEntity } from './knowledge-source.entity';

@Entity({ name: 'knowledge_suggestions' })
@Index('knowledge_suggestions_workspace_status_created', { synchronize: false })
@Index('knowledge_suggestions_workspace_bot_status_created', { synchronize: false })
@Index('knowledge_suggestions_one_pending_per_message', { synchronize: false })
export class KnowledgeSuggestionEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'knowledge_suggestions_workspace_fkey',
  })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  botId!: string;

  @ManyToOne(() => BotEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bot_id', foreignKeyConstraintName: 'knowledge_suggestions_bot_fkey' })
  bot!: BotEntity;

  @Column({ type: 'uuid', nullable: true })
  messageId!: string | null;

  @ManyToOne(() => MessageEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'message_id',
    foreignKeyConstraintName: 'knowledge_suggestions_message_fkey',
  })
  message!: MessageEntity | null;

  @Column({ type: 'uuid', nullable: true })
  conversationId!: string | null;

  @ManyToOne(() => ConversationEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'conversation_id',
    foreignKeyConstraintName: 'knowledge_suggestions_conversation_fkey',
  })
  conversation!: ConversationEntity | null;

  @Column({ type: 'text' })
  question!: string;

  @Column({ type: 'text' })
  answer!: string;

  @Column({
    type: 'enum',
    enum: SUGGESTION_STATUSES,
    enumName: 'suggestion_status',
    default: 'pending',
  })
  status!: SuggestionStatus;

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'knowledge_suggestions_created_by_fkey',
  })
  createdByUser!: UserEntity | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'reviewed_by',
    foreignKeyConstraintName: 'knowledge_suggestions_reviewed_by_fkey',
  })
  reviewedByUser!: UserEntity | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  rejectReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceId!: string | null;

  @ManyToOne(() => KnowledgeSourceEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'source_id', foreignKeyConstraintName: 'knowledge_suggestions_source_fkey' })
  source!: KnowledgeSourceEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
