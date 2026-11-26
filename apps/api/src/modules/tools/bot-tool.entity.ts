// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';

/** A workspace-owned, admin-configured tool attached to one bot. */
@Entity({ name: 'bot_tools' })
@Index('bot_tools_workspace_bot_idx', ['workspaceId', 'botId'])
@Index('bot_tools_bot_name_key', ['workspaceId', 'botId', 'name'], { unique: true })
@Index('bot_tools_id_workspace_bot_key', ['id', 'workspaceId', 'botId'], { unique: true })
@ForeignKey('BotEntity', ['botId', 'workspaceId'], ['id', 'workspaceId'], {
  name: 'bot_tools_bot_workspace_fkey',
  onDelete: 'CASCADE',
})
export class BotToolEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @ForeignKey('WorkspaceEntity', { name: 'bot_tools_workspace_id_fkey', onDelete: 'CASCADE' })
  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @Column({ type: 'uuid' })
  botId!: string;

  @Column({ type: 'text' })
  name!: string;

  /** Schema-validated definition; never contains remote credentials. */
  @Column({ type: 'jsonb' })
  definition!: Record<string, unknown>;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'text', nullable: true })
  testedDefinitionHash!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  testedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
