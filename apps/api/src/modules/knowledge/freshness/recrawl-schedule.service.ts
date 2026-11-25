// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';

import { BOSS_ROLE, type BossRole, PgBossHost } from '../../../jobs';
import { RECRAWL_SCHEDULE, SCHEDULE_RECRAWLS_JOB } from '../knowledge.jobs';

/** Registers the cron in pg-boss only in the worker process. */
@Injectable()
export class RecrawlScheduleService implements OnApplicationBootstrap {
  constructor(
    private readonly host: PgBossHost,
    @Inject(BOSS_ROLE) private readonly role: BossRole,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.role !== 'worker') return;
    await this.host.boss.schedule(SCHEDULE_RECRAWLS_JOB.name, RECRAWL_SCHEDULE, {});
  }
}
