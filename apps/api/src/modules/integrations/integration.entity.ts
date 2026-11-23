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

import {
  INTEGRATION_PROVIDERS,
  INTEGRATION_STATUSES,
  type IntegrationProvider,
  type IntegrationStatus,
} from '@app/shared';
import type { CrmContextFieldMap } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';

/** A provider connection owned by one workspace. Credentials live in a separate encrypted row. */
@Entity({ name: 'integrations' })
@Index('integrations_workspace_id', ['workspaceId'])
@Check(
  'integrations_provider_check',
  `"provider" IN ('hubspot','salesforce','dynamics365','zoho','pipedrive','zendesk','intercom','freshdesk')`,
)
@Check(
  'integrations_status_check',
  `"status" IN ('active','paused','reauth_required','error','disconnected')`,
)
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

  @Column({ type: 'text', default: 'active' })
  status!: IntegrationStatus;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  scopes!: string[];

  @Column({ type: 'text', nullable: true })
  externalAccountId!: string | null;

  @Column({ type: 'boolean', default: false })
  transcriptSharing!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  crmContextFields!: CrmContextFieldMap | null;

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
