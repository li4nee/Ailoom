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

import {
  INTEGRATION_PROVIDERS,
  INTEGRATION_STATUSES,
  type IntegrationProvider,
  type IntegrationStatus,
} from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';

/** A provider connection owned by one workspace. Credentials live in a separate encrypted row. */
@Entity({ name: 'integrations' })
@Index('integrations_workspace_id', ['workspaceId'])
export class IntegrationEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'integrations_workspace_id_fkey' })
  workspace!: WorkspaceEntity;

  @Column({ type: 'text' })
  provider!: IntegrationProvider;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  status!: IntegrationStatus;

  @Column({ type: 'text', array: true })
  scopes!: string[];

  @Column({ type: 'text', nullable: true })
  externalAccountId!: string | null;

  @Column({ type: 'boolean', default: false })
  transcriptSharing!: boolean;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  disconnectedAt!: Date | null;
}

// Keep the provider/status lists close to the entity for migration and validation readers.
export { INTEGRATION_PROVIDERS, INTEGRATION_STATUSES };
