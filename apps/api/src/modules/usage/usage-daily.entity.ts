// SPDX-License-Identifier: AGPL-3.0-only
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { BotEntity } from '../bots';
import { WorkspaceEntity } from '../workspaces';

/**
 * Per-bot daily rollup for dashboards and spend caps (spec §9.5), keyed by UTC day. Updated
 * with each trace insert (`INSERT … ON CONFLICT DO UPDATE`). The primary key starts with
 * `workspace_id`, so it also serves as the workspace index. bigint and numeric columns come
 * back from the pg driver as strings.
 */
@Entity({ name: 'usage_daily' })
export class UsageDailyEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'usage_daily_pkey' })
  workspaceId!: WorkspaceId;

  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'usage_daily_pkey' })
  botId!: string;

  /** UTC day, `YYYY-MM-DD`. */
  @PrimaryColumn({ type: 'date', primaryKeyConstraintName: 'usage_daily_pkey' })
  day!: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'usage_daily_workspace_id_fkey' })
  workspace!: WorkspaceEntity;

  @ManyToOne(() => BotEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bot_id', foreignKeyConstraintName: 'usage_daily_bot_id_fkey' })
  bot!: BotEntity;

  @Column({ type: 'int', default: 0 })
  conversations!: number;

  @Column({ type: 'int', default: 0 })
  visitorMessages!: number;

  @Column({ type: 'int', default: 0 })
  aiMessages!: number;

  @Column({ type: 'int', default: 0 })
  escalations!: number;

  @Column({ type: 'bigint', default: 0 })
  inputTokens!: string;

  @Column({ type: 'bigint', default: 0 })
  outputTokens!: string;

  @Column({ type: 'bigint', default: 0 })
  embeddingTokens!: string;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;
}
