// SPDX-License-Identifier: AGPL-3.0-only
import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';

export type ToolInvocationStatus = 'started' | 'complete' | 'failed';

/** Redacted, durable record of one tool execution attempt. No argument or result values are stored. */
@Entity({ name: 'tool_invocations' })
@Index('tool_invocations_workspace_turn_idx', ['workspaceId', 'turnId'])
@Index('tool_invocations_workspace_trace_idx', ['workspaceId', 'traceId'])
@Index('tool_invocations_created_at_idx', ['createdAt'])
@Check('tool_invocations_status_check', `"status" IN ('started', 'complete', 'failed')`)
@Check('tool_invocations_duration_check', '"duration_ms" IS NULL OR "duration_ms" >= 0')
@ForeignKey('BotEntity', ['botId', 'workspaceId'], ['id', 'workspaceId'], {
  name: 'tool_invocations_bot_workspace_fkey',
  onDelete: 'CASCADE',
})
export class ToolInvocationEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @ForeignKey('WorkspaceEntity', {
    name: 'tool_invocations_workspace_id_fkey',
    onDelete: 'CASCADE',
  })
  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @Column({ type: 'uuid' })
  botId!: string;

  @Column({ type: 'uuid' })
  toolId!: string;

  @Column({ type: 'int', default: 1 })
  toolVersion!: number;

  @ForeignKey('ConversationEntity', {
    name: 'tool_invocations_conversation_id_fkey',
    onDelete: 'SET NULL',
  })
  @Column({ type: 'uuid', nullable: true })
  conversationId!: string | null;

  @Column({ type: 'uuid' })
  turnId!: string;

  @ForeignKey('GenerationTraceEntity', {
    name: 'tool_invocations_trace_id_fkey',
    onDelete: 'SET NULL',
  })
  @Column({ type: 'uuid', nullable: true })
  traceId!: string | null;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  inputFields!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  outputFields!: string[];

  @Column({ type: 'text', default: 'started' })
  status!: ToolInvocationStatus;

  @Column({ type: 'text', nullable: true })
  errorCode!: string | null;

  @Column({ type: 'int', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
