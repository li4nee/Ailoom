// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import type { IntegrationProvider } from '@app/shared';
import type { CrmContextFieldMap } from '@app/shared';

import type { UserId, WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';

/** One-time, short-lived state for binding an OAuth callback to its initiating admin/workspace. */
@Entity({ name: 'integration_oauth_states' })
@Index('integration_oauth_states_workspace_id', ['workspaceId'])
export class IntegrationOAuthStateEntity extends TenantEntity {
  get id(): string {
    return this.stateHash;
  }

  @PrimaryColumn({ type: 'char', length: 64 })
  stateHash!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'integration_oauth_states_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  actorUserId!: UserId;

  @Column({ type: 'text' })
  provider!: IntegrationProvider;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  baseUrl!: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  scopes!: string[];

  @Column({ type: 'jsonb', nullable: true })
  crmContextFields!: CrmContextFieldMap | null;

  @Column({ type: 'text' })
  returnUrl!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
