// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import type { NotificationPayload, NotificationType } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';

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
}
