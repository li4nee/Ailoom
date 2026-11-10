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

import {
  CHANNELS,
  CONVERSATION_STATUSES,
  HANDOFF_REASONS,
  PRIORITIES,
  type Channel,
  type ConversationStatus,
  type HandoffReason,
  type Priority,
} from '@app/shared';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { UserEntity } from '../../auth';
import { BotEntity } from '../../bots';
import { WorkspaceEntity } from '../../workspaces';
import { ContactEntity } from './contact.entity';

/**
 * A conversation between a contact and a bot or agent (spec §9.4). The inbox index
 * `(workspace_id, status, last_message_at DESC)` is hand-written, hence `synchronize: false`;
 * it also serves as the workspace_id index.
 */
@Entity({ name: 'conversations' })
@Index('conversations_inbox', { synchronize: false })
@Index('conversations_contact_id', ['contactId'])
@Index('conversations_bot_id', ['botId'])
export class ConversationEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'conversations_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  botId!: string;

  @ManyToOne(() => BotEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bot_id', foreignKeyConstraintName: 'conversations_bot_id_fkey' })
  bot!: BotEntity;

  @Column({ type: 'uuid' })
  contactId!: string;

  @ManyToOne(() => ContactEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id', foreignKeyConstraintName: 'conversations_contact_id_fkey' })
  contact!: ContactEntity;

  @Column({ type: 'enum', enum: CHANNELS, enumName: 'channel', default: 'web' })
  channel!: Channel;

  @Column({
    type: 'enum',
    enum: CONVERSATION_STATUSES,
    enumName: 'conversation_status',
    default: 'ai',
  })
  status!: ConversationStatus;

  @Column({ type: 'uuid', nullable: true })
  assignedUserId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'assigned_user_id',
    foreignKeyConstraintName: 'conversations_assigned_user_id_fkey',
  })
  assignedUser!: UserEntity | null;

  @Column({ type: 'enum', enum: HANDOFF_REASONS, enumName: 'handoff_reason', nullable: true })
  handoffReason!: HandoffReason | null;

  @Column({ type: 'timestamptz', nullable: true })
  handoffRequestedAt!: Date | null;

  /** Phase 5 SLA. */
  @Column({ type: 'enum', enum: PRIORITIES, enumName: 'priority', default: 'normal' })
  priority!: Priority;

  /** Inbox sort key. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastMessageAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  /** Page URL, user agent, locale at start. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
