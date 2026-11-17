// SPDX-License-Identifier: AGPL-3.0-only
import {
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
import { WebhookEntity } from './webhook.entity';

@Entity({ name: 'webhook_deliveries' })
@Index('webhook_deliveries_workspace_id', ['workspaceId'])
@Index('webhook_deliveries_webhook_event_key', ['webhookId', 'eventId'], { unique: true })
export class WebhookDeliveryEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @Column({ type: 'uuid' })
  webhookId!: string;

  @ManyToOne(() => WebhookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'webhook_id',
    foreignKeyConstraintName: 'webhook_deliveries_webhook_id_fkey',
  })
  webhook!: WebhookEntity;

  @Column({ type: 'uuid' })
  eventId!: string;

  @Column({ type: 'text' })
  eventType!: IntegrationEventType;

  @Column({ type: 'text' })
  status!: 'pending' | 'retrying' | 'delivered' | 'failed' | 'skipped';

  @Column({ type: 'int', nullable: true })
  statusCode!: number | null;

  @Column({ type: 'int', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'webhook_deliveries_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;
}
