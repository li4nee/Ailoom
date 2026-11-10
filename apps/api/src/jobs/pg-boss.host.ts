// SPDX-License-Identifier: AGPL-3.0-only
import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { PgBoss } from 'pg-boss';

import { APP_CONFIG, type AppConfig } from '../common/config';
import { buildSsl } from '../db/data-source';

/** `api` only sends jobs; `worker` also processes them and runs pg-boss maintenance. */
export type BossRole = 'api' | 'worker';

export const BOSS_ROLE = Symbol('BOSS_ROLE');

/** How long `stop()` waits for running jobs before giving up on them (pg-boss retries them). */
const STOP_TIMEOUT_MS = 30_000;

/**
 * Owns the process's single pg-boss instance: starts it with the app (creating or migrating the
 * `pgboss` schema when needed) and stops it gracefully on shutdown, before the database pool
 * closes.
 */
@Injectable()
export class PgBossHost implements OnModuleInit, BeforeApplicationShutdown {
  readonly boss: PgBoss;
  private readonly logger = new Logger('PgBoss');

  constructor(@Inject(APP_CONFIG) config: AppConfig, @Inject(BOSS_ROLE) role: BossRole) {
    const ssl = buildSsl(config.database);
    this.boss = new PgBoss({
      connectionString: config.database.url,
      ...(ssl === false ? {} : { ssl }),
      application_name: `ailoom-${role}`,
      // The api is send-only: no supervision (maintenance) and no cron scheduling.
      ...(role === 'api' ? { supervise: false, schedule: false } : {}),
    });
    // pg-boss reports background failures as events; an unhandled `error` event would crash
    // the process.
    this.boss.on('error', (error) => {
      this.logger.error(error);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
  }
}
