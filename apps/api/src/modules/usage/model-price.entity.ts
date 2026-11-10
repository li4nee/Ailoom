// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { WorkspaceEntity } from '../workspaces';

/**
 * Price per million tokens for a provider model (spec §9.5). `workspace_id` null = built-in
 * default; non-null = a workspace override. One row per (provider, model, workspace) is enforced
 * by the hand-written expression index `model_prices_unique` (`coalesce(workspace_id, …)`, since
 * NULLs never collide in a plain unique index), hence `synchronize: false`.
 */
@Entity({ name: 'model_prices' })
@Index('model_prices_unique', { synchronize: false })
export class ModelPriceEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'text' })
  provider!: string;

  @Column({ type: 'text' })
  model!: string;

  @Column({ type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'model_prices_workspace_id_fkey' })
  workspace!: WorkspaceEntity | null;

  /** numeric: returned as a string. */
  @Column({ type: 'numeric', precision: 10, scale: 4 })
  inputPerMtokUsd!: string;

  @Column({ type: 'numeric', precision: 10, scale: 4 })
  outputPerMtokUsd!: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
