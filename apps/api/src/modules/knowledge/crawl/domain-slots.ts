// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Spec §12.1: at most two requests to one host at a time, instance-wide. */
export const SLOTS_PER_DOMAIN = 2;

/**
 * Per-domain concurrency for the crawl, across every worker process (spec §12.1). A Postgres
 * advisory lock is per database session, so each attempt holds a dedicated query runner for the
 * duration of the page fetch; `pg_try_advisory_lock` never waits, and a free slot releases as
 * soon as the runner is released, even if the process dies.
 */
@Injectable()
export class DomainSlots {
  constructor(private readonly ds: DataSource) {}

  /** Runs `fn` in a slot, or returns `'busy'` immediately when both slots are taken. */
  async withSlot<T>(domain: string, fn: () => Promise<T>): Promise<T | 'busy'> {
    const runner = this.ds.createQueryRunner();
    await runner.connect();
    try {
      for (let slot = 0; slot < SLOTS_PER_DOMAIN; slot += 1) {
        // Raw SQL: advisory locks are a Postgres primitive with no TypeORM API. The
        // QueryRunner's driver returns the rows themselves.
        const rows = (await runner.query(`SELECT pg_try_advisory_lock(hashtext($1), $2) AS ok`, [
          `crawl:${domain}`,
          slot,
        ])) as unknown as { ok: boolean }[];
        if (rows[0]?.ok !== true) continue;
        try {
          return await fn();
        } finally {
          await runner
            .query(`SELECT pg_advisory_unlock(hashtext($1), $2)`, [`crawl:${domain}`, slot])
            .catch(() => undefined);
        }
      }
      return 'busy';
    } finally {
      await runner.release();
    }
  }
}
