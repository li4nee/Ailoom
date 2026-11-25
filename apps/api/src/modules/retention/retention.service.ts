// SPDX-License-Identifier: AGPL-3.0-only
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { JobsService } from '../../jobs';
import { type JobDef } from '../../jobs/define-job';
import { SESSION_RETENTION_JOB } from '../auth';
import { CONVERSATION_RETENTION_JOB } from '../conversations';
import { NOTIFICATION_RETENTION_JOB } from '../notifications';
import { TRACE_RETENTION_JOB } from '../traces';

/** Retention runs daily at 03:00 UTC; the three queues are staggered by a few seconds. */
const RETENTION_HOUR_UTC = 3;
const STAGGER_SECONDS = 5;

/** Milliseconds from `now` to the next 03:00 UTC. */
function msUntilNextRun(now: Date): number {
  const next = new Date(now);
  next.setUTCHours(RETENTION_HOUR_UTC, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

/** Enqueues daily cleanup jobs so pg-boss processes them in the worker. */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Retention');
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly jobs: JobsService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.scheduleNextRun();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private scheduleNextRun(): void {
    if (this.stopped) return;
    const delay = msUntilNextRun(this.clock.now());
    this.timer = setTimeout(() => {
      void this.enqueueDue()
        .catch((error: unknown) => {
          this.logger.error({ err: error }, 'retention schedule failed');
        })
        .finally(() => {
          this.scheduleNextRun();
        });
    }, delay);
    this.timer.unref();
  }

  private async enqueueDue(): Promise<void> {
    const { sessionsDays, conversationsDays, tracesDays } = this.config.retention;

    await this.enqueueIfDue(SESSION_RETENTION_JOB, sessionsDays, 0);
    await this.enqueueIfDue(CONVERSATION_RETENTION_JOB, conversationsDays, STAGGER_SECONDS);
    await this.enqueueIfDue(TRACE_RETENTION_JOB, tracesDays, STAGGER_SECONDS * 2);
    await this.jobs.enqueue(NOTIFICATION_RETENTION_JOB, {}, { startAfter: STAGGER_SECONDS * 3 });
  }

  private async enqueueIfDue<P extends { olderThanDays: number }>(
    def: JobDef<P>,
    days: number,
    startAfterSeconds: number,
  ): Promise<void> {
    if (days <= 0) return;
    await this.jobs.enqueue(def, { olderThanDays: days }, { startAfter: startAfterSeconds });
  }
}
