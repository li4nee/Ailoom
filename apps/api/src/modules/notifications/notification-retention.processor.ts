// SPDX-License-Identifier: AGPL-3.0-only
import { PinoLogger } from 'nestjs-pino';

import { type JobHandler, JobProcessor } from '../../jobs';
import { NOTIFICATION_RETENTION_JOB } from './notification-retention.job';
import { NotificationsService } from './notifications.service';

@JobProcessor(NOTIFICATION_RETENTION_JOB)
export class NotificationRetentionProcessor implements JobHandler<Record<string, never>> {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationRetentionProcessor.name);
  }

  async handle(): Promise<void> {
    const deleted = await this.notifications.retain();
    this.logger.info({ deleted }, 'notifications retained');
  }
}
