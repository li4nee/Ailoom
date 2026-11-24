// SPDX-License-Identifier: AGPL-3.0-only
import { Global, Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { AuditModule } from '../audit';
import { WorkspacesModule } from '../workspaces';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationRetentionProcessor } from './notification-retention.processor';
import {
  NotificationPreferencesController,
  NotificationsController,
} from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { SuggestionNotificationsListener } from './suggestion-notifications.listener';

@Global()
@Module({
  imports: [AuditModule, WorkspacesModule],
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [
    NotificationsRepository,
    NotificationPreferencesService,
    NotificationsService,
    NotificationRetentionProcessor,
    SuggestionNotificationsListener,
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [NotificationsRepository, NotificationPreferencesService, NotificationsService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker.
export class NotificationsModule {}
