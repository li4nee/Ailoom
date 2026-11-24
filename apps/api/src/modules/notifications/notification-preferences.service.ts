// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  effectivePreferences,
  type NotificationPreferences,
  type NotificationPreferencesDto,
  type NotificationType,
  type Role,
} from '@app/shared';

import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import type { UserId, WorkspaceId } from '../../db/ids';
import { MembershipsRepository } from '../workspaces';

@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly ds: DataSource,
    private readonly memberships: MembershipsRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
  ) {}

  forType(role: Role, stored: NotificationPreferences | null | undefined, type: NotificationType) {
    return effectivePreferences(role, stored)[type];
  }

  async get(workspaceId: WorkspaceId, userId: UserId): Promise<NotificationPreferencesDto> {
    const membership = await this.memberships.notificationPreferences(workspaceId, userId);
    if (membership === null) throw new AppError('not_found');
    return effectivePreferences(membership.role, membership.notificationPreferences);
  }

  async update(
    workspaceId: WorkspaceId,
    userId: UserId,
    input: NotificationPreferences,
  ): Promise<NotificationPreferencesDto> {
    return this.ds.transaction(async (manager) => {
      const membership = await this.memberships.notificationPreferences(
        workspaceId,
        userId,
        manager,
      );
      if (membership === null) throw new AppError('not_found');
      const merged: NotificationPreferences = {
        ...membership.notificationPreferences,
        ...input,
      };
      await this.memberships.updateNotificationPreferences(workspaceId, userId, merged, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'notification.preferences_updated',
          targetType: 'membership',
          targetId: userId,
          metadata: { preferences: input },
        },
        manager,
      );
      return effectivePreferences(membership.role, merged);
    });
  }
}
