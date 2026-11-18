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

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { IntegrationEntity } from './integration.entity';

/** AES-256-GCM sealed OAuth/API-token material. Plaintext is never represented in a DTO. */
@Entity({ name: 'integration_credentials' })
@Index('integration_credentials_workspace_id', ['workspaceId'])
@Index('integration_credentials_integration_id_key', ['integrationId'], { unique: true })
export class IntegrationCredentialEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @Column({ type: 'uuid' })
  integrationId!: string;

  @ManyToOne(() => IntegrationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'integration_id',
    foreignKeyConstraintName: 'integration_credentials_integration_id_fkey',
  })
  integration!: IntegrationEntity;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'integration_credentials_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;

  @Column({ type: 'bytea' })
  ciphertext!: Buffer;

  @Column({ type: 'bytea' })
  iv!: Buffer;

  @Column({ type: 'bytea' })
  tag!: Buffer;

  @Column({ type: 'int' })
  keyVersion!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
