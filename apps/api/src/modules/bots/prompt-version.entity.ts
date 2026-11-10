// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { UserEntity } from '../auth';
import { WorkspaceEntity } from '../workspaces';
import { BotEntity } from './bot.entity';

/** One immutable save of a bot's instructions (spec §9.2). */
@Entity({ name: 'prompt_versions' })
@Index('prompt_versions_workspace_id', ['workspaceId'])
@Unique('prompt_versions_bot_id_version_key', ['botId', 'version'])
export class PromptVersionEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'prompt_versions_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  botId!: string;

  @ManyToOne(() => BotEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bot_id', foreignKeyConstraintName: 'prompt_versions_bot_id_fkey' })
  bot!: BotEntity;

  /** Unique per bot, increments. */
  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'text' })
  systemPrompt!: string;

  /** Optional change note. */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'prompt_versions_created_by_fkey' })
  createdByUser!: UserEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
