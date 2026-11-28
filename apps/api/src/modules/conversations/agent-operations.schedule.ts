// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, Optional, type OnApplicationBootstrap } from '@nestjs/common';

import { BOSS_ROLE, type BossRole, PgBossHost } from '../../jobs';
import { REVIEW_SLA_BREACHES_JOB, SLA_REVIEW_SCHEDULE } from './agent-operations.job';

/** Registers minute-level breach processing in worker processes only. */
@Injectable()
export class AgentOperationsSchedule implements OnApplicationBootstrap {
  constructor(
    @Optional() private readonly host?: PgBossHost,
    @Optional() @Inject(BOSS_ROLE) private readonly role?: BossRole,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const host = this.host;
    if (this.role !== 'worker' || host === undefined) return;
    await host.boss.schedule(REVIEW_SLA_BREACHES_JOB.name, SLA_REVIEW_SCHEDULE, {});
  }
}
