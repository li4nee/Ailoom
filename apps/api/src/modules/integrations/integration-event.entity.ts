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

import type { IntegrationEventType } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';

/** Transactional integration outbox row. Payload is the sanitized event envelope data only. */
@Entity({ name: 'integration_events' })
@Index('integration_events_workspace_id', ['workspaceId'])
@Index('integration_events_workspace_idempotency_key', ['workspaceId', 'idempotencyKey'], {
  unique: true,
})
@Index('integration_events_dispatch_order', ['dispatchedAt', 'leasedUntil', 'occurredAt', 'id'])
@Check(
  'integration_events_type_check',
  `"type" IN ('contact.created','contact.updated','conversation.created','conversation.updated','message.created','handoff.requested','conversation.closed','feedback.created')`,
)
export class IntegrationEventEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'integration_events_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;

  @Column({ type: 'text' })
  type!: IntegrationEventType;

  @Column({ type: 'uuid' })
  aggregateId!: string;

  @Column({ type: 'text' })
  idempotencyKey!: string;

  @Column({ type: 'jsonb' })
  data!: unknown;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  leasedUntil!: Date | null;

  @Column({ type: 'text', nullable: true })
  leaseOwner!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  dispatchedAt!: Date | null;
}
