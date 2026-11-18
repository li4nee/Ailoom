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
  UpdateDateColumn,
} from 'typeorm';

import type { IntegrationEventType } from '@app/shared';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { WorkspaceEntity } from '../../workspaces/entities/workspace.entity';

@Entity({ name: 'webhooks' })
@Index('webhooks_workspace_id', ['workspaceId'])
@Check('webhooks_status_check', `"status" IN ('active','paused')`)
export class WebhookEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'webhooks_workspace_id_fkey' })
  workspace!: WorkspaceEntity;

  @Column({ type: 'text' })
  url!: string;

  @Column({ type: 'text', array: true })
  events!: IntegrationEventType[];

  @Column({ type: 'text', default: 'active' })
  status!: 'active' | 'paused';

  @Column({ type: 'bytea' })
  secretCiphertext!: Buffer;

  @Column({ type: 'bytea' })
  secretIv!: Buffer;

  @Column({ type: 'bytea' })
  secretTag!: Buffer;

  @Column({ type: 'int' })
  keyVersion!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
