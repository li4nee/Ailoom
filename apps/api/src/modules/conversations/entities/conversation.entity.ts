// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import {
  CONVERSATION_STATUSES,
  CHANNELS,
  PRIORITIES,
  type ConversationStatus,
  type Channel,
  type Priority,
} from '@app/shared';

const conversationStatuses = [...(CONVERSATION_STATUSES as unknown as string[])];
const channels = [...(CHANNELS as unknown as string[])];
const priorities = [...(PRIORITIES as unknown as string[])];

@Entity('conversations')
@Index(['workspaceId', 'contactId'])
@Index(['workspaceId', 'botId'])
@Index(['workspaceId', 'status'])
@Index(['workspaceId', 'lastMessageAt'])
export class ConversationEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'uuid' })
  contactId!: string;

  @Column({ type: 'uuid', nullable: true })
  botId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  assigneeId!: string | null;

  @Column({
    type: 'enum',
    enum: conversationStatuses,
    enumName: 'conversation_status',
    default: 'ai',
  })
  status!: ConversationStatus;

  @Column({
    type: 'enum',
    enum: channels,
    enumName: 'channel',
    default: 'web',
  })
  channel!: Channel;

  @Column({
    type: 'enum',
    enum: priorities,
    enumName: 'priority',
    default: 'normal',
  })
  priority!: Priority;

  @Column({ type: 'text', nullable: true })
  subject!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  handoffReason!: string | null;

  @Column({ type: 'text', nullable: true })
  handoffMessage!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastMessageAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  messageCount!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
