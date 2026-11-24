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

import { ROLES, type Role } from '@app/shared';
import type { NotificationPreferences } from '@app/shared';

import { UserEntity } from '../../auth';
import { WorkspaceEntity } from './workspace.entity';

@Entity({ name: 'memberships' })
@Index('memberships_one_owner', ['workspaceId'], {
  unique: true,
  where: `"role" = 'owner'`,
})
export class MembershipEntity {
  @PrimaryColumn({ type: 'uuid' })
  workspaceId!: string;

  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'enum', enum: ROLES, enumName: 'role' })
  role!: Role;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  notificationPreferences!: NotificationPreferences;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'memberships_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'memberships_user_id_fkey' })
  user!: UserEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
