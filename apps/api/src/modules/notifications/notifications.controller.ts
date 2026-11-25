// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import {
  notificationPreferencesSchema,
  notificationQuerySchema,
  type NotificationDto,
  type NotificationPreferencesDto,
} from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, SessionOnly, type Principal } from '../auth';
import { NotificationsService } from './notifications.service';

class NotificationQueryDto extends createZodDto(notificationQuerySchema) {}
class NotificationPreferencesRequestDto extends createZodDto(notificationPreferencesSchema) {}

@SessionOnly()
@RequireRole('agent')
@Controller('v1/workspaces/:workspaceId/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: NotificationQueryDto,
  ): Promise<{ data: NotificationDto[]; nextCursor: string | null; unreadCount: number }> {
    return this.notifications.list(this.workspaceOf(principal), principal.userId, query);
  }

  @Post('read-all')
  markAllRead(@CurrentPrincipal() principal: Principal): Promise<{ updated: number }> {
    return this.notifications.markAllRead(this.workspaceOf(principal), principal.userId);
  }

  @Post(':notificationId/read')
  markRead(
    @CurrentPrincipal() principal: Principal,
    @Param('notificationId') notificationId: string,
  ): Promise<NotificationDto> {
    return this.notifications.markRead(
      this.workspaceOf(principal),
      principal.userId,
      notificationId,
    );
  }

  private workspaceOf(principal: Principal): WorkspaceId {
    const workspaceId = principal.workspace?.id;
    if (workspaceId === undefined) throw new AppError('not_found');
    return workspaceId;
  }
}

@SessionOnly()
@RequireRole('agent')
@Controller('v1/workspaces/:workspaceId/notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  get(@CurrentPrincipal() principal: Principal): Promise<NotificationPreferencesDto> {
    return this.notifications.getPreferences(this.workspaceOf(principal), principal.userId);
  }

  @Put()
  update(
    @CurrentPrincipal() principal: Principal,
    @Body() body: NotificationPreferencesRequestDto,
  ): Promise<NotificationPreferencesDto> {
    return this.notifications.updatePreferences(
      this.workspaceOf(principal),
      principal.userId,
      body,
    );
  }

  private workspaceOf(principal: Principal): WorkspaceId {
    const workspaceId = principal.workspace?.id;
    if (workspaceId === undefined) throw new AppError('not_found');
    return workspaceId;
  }
}
