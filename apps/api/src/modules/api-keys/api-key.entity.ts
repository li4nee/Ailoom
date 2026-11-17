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

import type { ApiKeyScope } from '@app/shared';

import type { UserId, WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { UserEntity } from '../auth/entities/user.entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';

/** A hashed, scoped machine credential owned by one workspace. */
@Entity({ name: 'api_keys' })
@Index('api_keys_workspace_id', ['workspaceId'])
@Index('api_keys_workspace_key_hash_key', ['workspaceId', 'keyHash'], { unique: true })
export class ApiKeyEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'api_keys_workspace_id_fkey' })
  workspace!: WorkspaceEntity;

  @Column({ type: 'text' })
  name!: string;

  /** Only the SHA-256 digest is stored; the raw token is returned once at creation. */
  @Column({ type: 'text' })
  keyHash!: string;

  @Column({ type: 'text' })
  keyPrefix!: string;

  @Column({ type: 'text', array: true })
  scopes!: ApiKeyScope[];

  @Column({ type: 'uuid' })
  createdByUserId!: UserId;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by_user_id',
    foreignKeyConstraintName: 'api_keys_created_by_user_id_fkey',
  })
  createdByUser!: UserEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
