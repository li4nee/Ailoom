// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Clock } from '../../common/clock';
import { APP_CONFIG } from '../../common/config';
import { type AppConfig } from '../../common/config';
import { WorkerHeartbeatEntity } from '../instance/entities/worker-heartbeat.entity';

/** Service for writing worker heartbeats. */
@Injectable()
export class HeartbeatService {
  constructor(
    private readonly ds: DataSource,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Records or updates the heartbeat for the current worker.
   * Uses the process ID as the worker identifier.
   */
  async beat(): Promise<void> {
    const workerId = process.pid.toString();
    const now = this.clock.now();

    await this.ds
      .createQueryBuilder()
      .insert()
      .into(WorkerHeartbeatEntity)
      .values({
        workerId,
        lastBeatAt: now,
        version: this.config.version,
      })
      .orUpdate(['last_beat_at', 'version'], ['worker_id'])
      .execute();
  }
}
