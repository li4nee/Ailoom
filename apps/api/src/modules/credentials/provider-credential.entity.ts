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

import { PROVIDER_KINDS, type ProviderKind } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { WorkspaceEntity } from '../workspaces';

/** A workspace's encrypted provider API key (spec §9.2, §11.1). */
@Entity({ name: 'provider_credentials' })
@Index('provider_credentials_workspace_id', ['workspaceId'])
export class ProviderCredentialEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'provider_credentials_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;

  @Column({ type: 'enum', enum: PROVIDER_KINDS, enumName: 'provider_kind' })
  provider!: ProviderKind;

  @Column({ type: 'text' })
  label!: string;

  /** AES-256-GCM; null for keyless providers (Ollama, local). */
  @Column({ type: 'bytea', nullable: true })
  secretCiphertext!: Buffer | null;

  @Column({ type: 'bytea', nullable: true })
  secretIv!: Buffer | null;

  @Column({ type: 'bytea', nullable: true })
  secretTag!: Buffer | null;

  /** Which master key encrypted the secret (rotation). */
  @Column({ type: 'int', nullable: true })
  keyVersion!: number | null;

  @Column({ type: 'text', nullable: true })
  secretLast4!: string | null;

  /** Required for `ollama` and `openai_compatible`. */
  @Column({ type: 'text', nullable: true })
  baseUrl!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastErrorAt!: Date | null;

  /** Redacted provider error. */
  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
