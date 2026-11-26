// SPDX-License-Identifier: AGPL-3.0-only
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryColumn,
  Unique,
} from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';

/** Immutable snapshot of one admin-approved tool configuration version. */
@Entity({ name: 'bot_tool_versions' })
@Unique('bot_tool_versions_workspace_tool_version_key', ['workspaceId', 'toolId', 'version'])
@Check('bot_tool_versions_version_check', '"version" > 0')
@ForeignKey('BotEntity', ['botId', 'workspaceId'], ['id', 'workspaceId'], {
  name: 'bot_tool_versions_bot_workspace_fkey',
  onDelete: 'CASCADE',
})
@ForeignKey('BotToolEntity', ['toolId', 'workspaceId', 'botId'], ['id', 'workspaceId', 'botId'], {
  name: 'bot_tool_versions_tool_workspace_bot_fkey',
  onDelete: 'CASCADE',
})
export class BotToolVersionEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @ForeignKey('WorkspaceEntity', { name: 'bot_tool_versions_workspace_fkey', onDelete: 'CASCADE' })
  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @Column({ type: 'uuid' })
  botId!: string;

  @Column({ type: 'uuid' })
  toolId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'jsonb' })
  definition!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
