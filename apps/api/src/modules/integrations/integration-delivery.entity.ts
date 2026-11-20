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

import type { IntegrationEventType, IntegrationDeliveryStatus } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { IntegrationEventEntity } from './integration-event.entity';
import { IntegrationEntity } from './integration.entity';

/** One native CRM connector's outcome for one workspace event; never stores payload bodies. */
@Entity({ name: 'integration_deliveries' })
@Index('integration_deliveries_workspace_id', ['workspaceId'])
@Index('integration_deliveries_integration_created', ['integrationId', 'createdAt'])
@Index('integration_deliveries_integration_event', ['integrationId', 'eventId'], { unique: true })
@Check(
  'integration_deliveries_status_check',
  `"status" IN ('pending','sending','retrying','delivered','failed','skipped')`,
)
export class IntegrationDeliveryEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @Column({ type: 'uuid' })
  integrationId!: string;

  @Column({ type: 'uuid' })
  eventId!: string;

  @Column({ type: 'text' })
  eventType!: IntegrationEventType;

  @Column({ type: 'text', default: 'pending' })
  status!: IntegrationDeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ type: 'int', nullable: true })
  statusCode!: number | null;

  @Column({ type: 'int', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'text', nullable: true })
  externalObjectType!: string | null;

  @Column({ type: 'text', nullable: true })
  externalObjectId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => IntegrationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'integration_id',
    foreignKeyConstraintName: 'integration_deliveries_integration_id_fkey',
  })
  integration!: IntegrationEntity;

  @ManyToOne(() => IntegrationEventEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'event_id',
    foreignKeyConstraintName: 'integration_deliveries_event_id_fkey',
  })
  event!: IntegrationEventEntity;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'integration_deliveries_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;
}
