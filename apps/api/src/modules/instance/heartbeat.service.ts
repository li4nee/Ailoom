// SPDX-License-Identifier: AGPL-3.0-only
import { hostname } from 'node:os';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { WorkerHeartbeatEntity } from './entities/worker-heartbeat.entity';

/** Spec §19: the worker writes a heartbeat row every 30 s. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * The worker's liveness signal: one `worker_heartbeats` row per worker process, refreshed
 * every 30 s while the worker runs. Readers (diagnostics, the container health check) treat a
 * row older than 90 s as a dead worker.
 */
@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  /** hostname + pid (spec §9.6). */
  readonly workerId = `${hostname()}:${String(process.pid)}`;
  private timer: NodeJS.Timeout | undefined;
  private readonly logger = new Logger('Heartbeat');

  constructor(
    private readonly ds: DataSource,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Upserts this worker's row with the current time and app version. */
  async beat(): Promise<void> {
    await this.ds
      .createQueryBuilder()
      .insert()
      .into(WorkerHeartbeatEntity)
      .values({
        workerId: this.workerId,
        lastBeatAt: this.clock.now(),
        version: this.config.version,
      })
      .orUpdate(['last_beat_at', 'version'], ['worker_id'])
      .execute();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => {
      this.beat().catch((error: unknown) => {
        this.logger.error({ err: error }, 'heartbeat failed');
      });
    }, HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }
}
