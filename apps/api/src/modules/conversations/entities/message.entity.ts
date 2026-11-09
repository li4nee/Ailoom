// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import {
  MESSAGE_ROLES,
  MESSAGE_STATUSES,
  type MessageRole,
  type MessageStatus,
  type TraceDecision,
} from '@app/shared';

const messageRoles = [...(MESSAGE_ROLES as unknown as string[])];
const messageStatuses = [...(MESSAGE_STATUSES as unknown as string[])];

@Entity('messages')
@Index(['workspaceId', 'conversationId'])
@Index(['workspaceId', 'contactId'])
@Index(['workspaceId', 'role'])
@Index(['workspaceId', 'status'])
@Index(['workspaceId', 'createdAt'])
export class MessageEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'uuid' })
  conversationId!: string;

  @Column({ type: 'uuid' })
  contactId!: string;

  @Column({ type: 'uuid', nullable: true })
  botId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({
    type: 'enum',
    enum: messageRoles,
    enumName: 'message_role',
  })
  role!: MessageRole;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'jsonb', default: [] })
  toolCalls!: unknown[];

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: messageStatuses,
    enumName: 'message_status',
    default: 'pending',
  })
  status!: MessageStatus;

  @Column({ type: 'varchar', length: 100, nullable: true })
  traceDecision!: TraceDecision | null;

  @Column({ type: 'int', default: 0 })
  inputTokens!: number;

  @Column({ type: 'int', default: 0 })
  outputTokens!: number;

  @Column({ type: 'int', default: 0 })
  ttftMs!: number;

  // Generated tsv column for full-text search
  @Column({ type: 'tsvector', select: false, nullable: true })
  tsv!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
