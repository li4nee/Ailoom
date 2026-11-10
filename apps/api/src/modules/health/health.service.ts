// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable, Logger } from '@nestjs/common';

import { JobsService } from '../../jobs';
import { ReadinessRepository } from './readiness.repository';

/** Each check is `'ok'` (pgvector: its version) or a short reason it failed. */
export interface Readiness {
  status: 'ok' | 'error';
  checks: { db: string; migrations: string; queue: string; pgvector: string };
}

interface CheckResult {
  ok: boolean;
  /** `'ok'`, the pgvector version, or why the check failed. */
  value: string;
}

const OK: CheckResult = { ok: true, value: 'ok' };

function failed(reason: string): CheckResult {
  return { ok: false, value: reason };
}

/** Iterative index scans (spec §13.1) need pgvector 0.8. */
const PGVECTOR_MIN: readonly [number, number] = [0, 8];

function supportsIterativeScan(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > PGVECTOR_MIN[0] || (major === PGVECTOR_MIN[0] && minor >= PGVECTOR_MIN[1]);
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger('Health');

  constructor(
    private readonly readiness: ReadinessRepository,
    private readonly jobs: JobsService,
  ) {}

  /** Runs every check; never throws. A failing check carries its reason, never raw errors. */
  async ready(): Promise<Readiness> {
    const [db, migrations, queue, pgvector] = await Promise.all([
      this.check('db', 'database unreachable', async () => {
        await this.readiness.ping();
        return OK;
      }),
      this.check('migrations', 'migration check failed', async () =>
        (await this.readiness.hasPendingMigrations()) ? failed('pending migrations') : OK,
      ),
      this.check('queue', 'queue unavailable', async () => {
        await this.jobs.assertQueueReady();
        return OK;
      }),
      this.check('pgvector', 'pgvector check failed', async () => {
        const version = await this.readiness.pgvectorVersion();
        if (version === null) return failed('pgvector not installed');
        if (!supportsIterativeScan(version)) return failed('pgvector >= 0.8 required');
        return { ok: true, value: version };
      }),
    ]);
    return {
      status: [db, migrations, queue, pgvector].every((c) => c.ok) ? 'ok' : 'error',
      checks: {
        db: db.value,
        migrations: migrations.value,
        queue: queue.value,
        pgvector: pgvector.value,
      },
    };
  }

  /** A probe that throws fails its check with the generic `failure` reason (and a log line). */
  private async check(
    name: string,
    failure: string,
    probe: () => Promise<CheckResult>,
  ): Promise<CheckResult> {
    try {
      return await probe();
    } catch (error) {
      this.logger.warn({ err: error, check: name }, `readiness check ${name} failed`);
      return failed(failure);
    }
  }
}
