// SPDX-License-Identifier: AGPL-3.0-only
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { OutboxDispatcher } from './outbox-dispatcher';

/** How often the worker checks for committed integration events. */
export const OUTBOX_POLL_INTERVAL_MS = 1_000;

/** Moves committed outbox events onto pg-boss; the API process remains send-only. */
@Injectable()
export class OutboxPollingService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('OutboxPolling');
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly dispatcher: OutboxDispatcher) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.poll();
    }, OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
    void this.poll();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.dispatcher.dispatch();
    } catch (error) {
      this.logger.error({ err: error }, 'outbox dispatch failed; it will retry on the next poll');
    } finally {
      this.running = false;
    }
  }
}
