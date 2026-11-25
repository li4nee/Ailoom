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
} from 'typeorm';

import { EVAL_RUN_STATUSES, type EvalRunStatus } from '@app/shared';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { UserEntity } from '../../auth';
import { BotEntity } from '../../bots';
import { WorkspaceEntity } from '../../workspaces';
import { EvalDatasetEntity } from './eval-dataset.entity';

@Entity({ name: 'eval_runs' })
@Index('eval_runs_workspace_dataset_created', ['workspaceId', 'datasetId', 'createdAt'])
@Index('eval_runs_workspace_bot_status', ['workspaceId', 'botId', 'status'])
@Check(
  'eval_runs_counts_check',
  '"cases_total" >= 0 AND "cases_done" >= 0 AND "cases_done" <= "cases_total"',
)
@Check('eval_runs_cost_check', '"cost_usd" >= 0')
export class EvalRunEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'eval_runs_workspace_fkey' })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  botId!: string;

  @ManyToOne(() => BotEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bot_id', foreignKeyConstraintName: 'eval_runs_bot_fkey' })
  bot!: BotEntity;

  @Column({ type: 'uuid' })
  datasetId!: string;

  @ManyToOne(() => EvalDatasetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dataset_id', foreignKeyConstraintName: 'eval_runs_dataset_fkey' })
  dataset!: EvalDatasetEntity;

  @Column({ type: 'enum', enum: EVAL_RUN_STATUSES, enumName: 'eval_run_status', default: 'queued' })
  status!: EvalRunStatus;

  @Column({ type: 'jsonb' })
  config!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  casesSnapshot!: unknown[];

  @Column({ type: 'integer', default: 0 })
  casesTotal!: number;

  @Column({ type: 'integer', default: 0 })
  casesDone!: number;

  @Column({ type: 'jsonb', nullable: true })
  summary!: Record<string, unknown> | null;

  @Column({ type: 'uuid', nullable: true })
  baselineRunId!: string | null;

  @ManyToOne(() => EvalRunEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'baseline_run_id', foreignKeyConstraintName: 'eval_runs_baseline_fkey' })
  baselineRun!: EvalRunEntity | null;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'eval_runs_created_by_fkey' })
  createdByUser!: UserEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;
}
