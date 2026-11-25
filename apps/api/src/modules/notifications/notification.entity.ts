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

import type { NotificationPayload, NotificationType } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { UserEntity } from '../auth';
import { MembershipEntity, WorkspaceEntity } from '../workspaces';

@Entity({ name: 'notifications' })
@Index('notifications_inbox_idx', { synchronize: false })
@Index('notifications_unread_dedupe_idx', { synchronize: false })
export class NotificationEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  workspaceId!: WorkspaceId;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({
    type: 'enum',
    enum: [
      'handoff_requested',
      'conversation_assigned',
      'visitor_replied',
      'spend_alert',
      'suggestion_created',
      'suggestion_reviewed',
    ],
    enumName: 'notification_type',
  })
  type!: NotificationType;

  @Column({ type: 'jsonb' })
  payload!: NotificationPayload;

  @Column({ type: 'text', nullable: true })
  dedupeKey!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'notifications_workspace_fkey',
  })
  workspace!: WorkspaceEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'notifications_user_fkey' })
  user!: UserEntity;

  @ManyToOne(() => MembershipEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'workspace_id',
      referencedColumnName: 'workspaceId',
      foreignKeyConstraintName: 'notifications_membership_fkey',
    },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  membership!: MembershipEntity;
}
