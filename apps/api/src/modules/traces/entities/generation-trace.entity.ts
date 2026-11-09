// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import { TRACE_DECISIONS, TRACE_ORIGINS, type TraceDecision, type TraceOrigin } from '@app/shared';

const traceDecisions = [...(TRACE_DECISIONS as unknown as string[])];
const traceOrigins = [...(TRACE_ORIGINS as unknown as string[])];

@Entity('generation_traces')
@Index(['workspaceId', 'botId'])
@Index(['workspaceId', 'conversationId'])
@Index(['workspaceId', 'decision'])
@Index(['workspaceId', 'createdAt'])
export class GenerationTraceEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'uuid', nullable: true })
  botId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  conversationId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  messageId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'text' })
  prompt!: string;

  @Column({ type: 'text', nullable: true })
  completion!: string | null;

  @Column({ type: 'jsonb', default: {} })
  modelParams!: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: traceDecisions,
    enumName: 'trace_decision',
    nullable: true,
  })
  decision!: TraceDecision | null;

  @Column({
    type: 'enum',
    enum: traceOrigins,
    enumName: 'trace_origin',
  })
  origin!: TraceOrigin;

  @Column({ type: 'int', default: 0 })
  inputTokens!: number;

  @Column({ type: 'int', default: 0 })
  outputTokens!: number;

  @Column({ type: 'int', default: 0 })
  ttftMs!: number;

  @Column({ type: 'int', default: 0 })
  latencyMs!: number;

  @Column({ type: 'text', nullable: true })
  errorCode!: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
