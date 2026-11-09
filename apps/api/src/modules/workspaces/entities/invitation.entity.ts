// SPDX-License-Identifier: AGPL-3.0-only
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { INVITATION_ROLES, type InvitationRole } from '@app/shared';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { WorkspaceEntity } from './workspace.entity';

@Entity({ name: 'invitations' })
@Index('invitations_workspace_id', ['workspaceId'])
@Index('invitations_token_hash_key', ['tokenHash'], { unique: true })
export class InvitationEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @Column({ type: 'citext' })
  email!: string;

  @Column({ type: 'enum', enum: INVITATION_ROLES, enumName: 'invitation_role' })
  role!: InvitationRole;

  @Column({ type: 'text' })
  tokenHash!: string;

  @Column({ type: 'uuid' })
  invitedBy!: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'invitations_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invited_by', foreignKeyConstraintName: 'invitations_invited_by_fkey' })
  invitedByUser!: UserEntity;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;
}
