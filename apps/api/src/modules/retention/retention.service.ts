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
import { TRACE_RETENTION_JOB } from '../traces';

/** How often the scheduler checks whether a cleanup pass is due. */
const SCHEDULE_INTERVAL_MS = 60_000;

/** Enqueues cleanup jobs at a fixed cadence so pg-boss processes them in the worker. */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Retention');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly jobs: JobsService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.enqueueDue();
    this.timer = setInterval(() => {
      void this.enqueueDue().catch((error: unknown) => {
        this.logger.error({ err: error }, 'retention schedule failed');
      });
    }, SCHEDULE_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async enqueueDue(): Promise<void> {
    const now = this.clock.now();
    const { sessionsDays, conversationsDays, tracesDays } = this.config.retention;

    // Stagger the three jobs by a few seconds so they don't all start at once.
    await this.enqueueIfDue(
      SESSION_RETENTION_JOB,
      sessionsDays,
      { olderThanDays: sessionsDays },
      now,
      0,
    );
    await this.enqueueIfDue(
      CONVERSATION_RETENTION_JOB,
      conversationsDays,
      { olderThanDays: conversationsDays },
      now,
      5_000,
    );
    await this.enqueueIfDue(
      TRACE_RETENTION_JOB,
      tracesDays,
      { olderThanDays: tracesDays },
      now,
      10_000,
    );
  }

  private async enqueueIfDue<P extends object>(
    def: JobDef<P>,
    days: number,
    payload: P,
    _now: Date,
    delayMs: number,
  ): Promise<void> {
    if (days <= 0) return;
    await this.jobs.enqueue(def, payload, { startAfter: delayMs });
  }
}
