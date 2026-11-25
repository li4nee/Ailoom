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
  Unique,
} from 'typeorm';

import { TRACE_DECISIONS, type TraceDecision } from '@app/shared';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { GenerationTraceEntity } from '../../traces/generation-trace.entity';
import { WorkspaceEntity } from '../../workspaces';
import { EvalCaseEntity } from './eval-case.entity';
import { EvalRunEntity } from './eval-run.entity';

@Entity({ name: 'eval_results' })
@Index('eval_results_workspace_run_created', ['workspaceId', 'runId', 'createdAt'])
@Unique('eval_results_run_case_key', ['runId', 'caseId'])
@Check('eval_results_cost_check', '"cost_usd" >= 0')
@Check('eval_results_latency_check', '"latency_ms" IS NULL OR "latency_ms" >= 0')
export class EvalResultEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'eval_results_workspace_fkey' })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  runId!: string;

  @ManyToOne(() => EvalRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id', foreignKeyConstraintName: 'eval_results_run_fkey' })
  run!: EvalRunEntity;

  @Column({ type: 'uuid', nullable: true })
  caseId!: string | null;

  @ManyToOne(() => EvalCaseEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'case_id', foreignKeyConstraintName: 'eval_results_case_fkey' })
  evalCase!: EvalCaseEntity | null;

  @Column({ type: 'uuid', nullable: true })
  traceId!: string | null;

  @ManyToOne(() => GenerationTraceEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'trace_id', foreignKeyConstraintName: 'eval_results_trace_fkey' })
  trace!: GenerationTraceEntity | null;

  @Column({ type: 'enum', enum: TRACE_DECISIONS, enumName: 'trace_decision' })
  decision!: TraceDecision;

  @Column({ type: 'text', default: '' })
  answer!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  citations!: unknown[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  retrieved!: unknown[];

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metrics!: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  passed!: boolean;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'integer', nullable: true })
  latencyMs!: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
