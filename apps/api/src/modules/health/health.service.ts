// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unsafe-assignment */
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { APP_CONFIG } from '../../common/config';
import { type AppConfig } from '../../common/config';
import { DATA_SOURCE } from '../../db';
import { PG_BOSS_TOKEN } from '../../jobs';
import { TypedPgBoss } from '../../jobs/pg-boss-wrapper';

export interface HealthCheckResult {
  status: 'ok' | 'error';
  checks: {
    db: string;
    migrations: string;
    queue: string;
    pgvector: string;
  };
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DATA_SOURCE) private readonly ds: DataSource,
    @Inject(PG_BOSS_TOKEN) private readonly boss: TypedPgBoss,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async checkReadiness(): Promise<HealthCheckResult> {
    const checks = {
      db: 'ok' as string,
      migrations: 'ok' as string,
      queue: 'ok' as string,
      pgvector: 'ok' as string,
    };

    // Check database connectivity
    try {
      await this.ds.query('SELECT 1');
    } catch {
      checks.db = 'database unreachable';
    }

    // Check pending migrations
    try {
      const pending = await this.ds.showMigrations();
      if (pending.length > 0) {
        checks.migrations = 'pending migrations';
      }
    } catch {
      checks.migrations = 'migration check failed';
    }

    // Check pg-boss queue
    if (this.boss) {
      try {
        await this.boss.getQueueSize();
      } catch {
        checks.queue = 'queue unavailable';
      }
    } else {
      checks.queue = 'queue not configured';
    }

    // Check pgvector version
    try {
      const [{ extversion }] = await this.ds.query<{ extversion: string }[]>(
        `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
      );
      checks.pgvector = extversion;
    } catch {
      checks.pgvector = 'pgvector not installed';
    }

    const allOk = Object.values(checks).every((v) => v === 'ok' || /^0\.(8|9)|^[1-9]/.exec(v));

    return {
      status: allOk ? 'ok' : 'error',
      checks,
    };
  }
}
