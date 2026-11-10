// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import type { Db, SendOptions } from 'pg-boss';
import type { EntityManager } from 'typeorm';

import { AppError } from '../common/errors';
import { type JobDef, queueOptions } from './define-job';
import { PgBossHost } from './pg-boss.host';

export interface EnqueueOptions {
  /**
   * The caller's transaction. The job row is written on its connection, so it commits or rolls
   * back with the caller's own writes (architecture §4.6): no job for a rolled-back write, no
   * lost job after a commit. Must be the manager of an active transaction (the one
   * `DataSource.transaction()` passes); anything else throws rather than enqueue outside one.
   */
  manager?: EntityManager;
  /** At most one queued job per key. */
  singletonKey?: string;
  /** Run no earlier than this time, or this many seconds from now. */
  startAfter?: Date | number;
}

/**
 * pg-boss's `db` adapter over the connection of a TypeORM transaction. Refuses a manager that is
 * not inside a transaction: without one the job would commit on its own and survive a rollback
 * of the caller's writes, which is exactly what passing a manager is meant to prevent.
 */
function transactionDb(manager: EntityManager, jobName: string): Db {
  const runner = manager.queryRunner;
  if (!runner?.isTransactionActive) {
    throw new AppError('internal_error', {
      message: `Job ${jobName}: opts.manager must be the manager of an active transaction (use DataSource.transaction()); omit it to enqueue outside one.`,
    });
  }
  return {
    executeSql: async (text, values) => {
      const result = await runner.query(text, values, true);
      const rows: unknown[] = result.records;
      return { rows };
    },
  };
}

/** Sends jobs. Available in both the api and the worker. */
@Injectable()
export class JobsService {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly host: PgBossHost) {}

  /**
   * Validates `payload` against the definition and queues a job. Returns the job id, or null
   * when a job with the same `singletonKey` is already queued.
   */
  async enqueue<P extends object>(
    def: JobDef<P>,
    payload: P,
    opts: EnqueueOptions = {},
  ): Promise<string | null> {
    const parsed = def.schema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError('internal_error', {
        message: `Invalid payload for job ${def.name}.`,
        cause: parsed.error,
      });
    }

    // Before any I/O: a manager outside a transaction must not even create the queue.
    const db = opts.manager === undefined ? undefined : transactionDb(opts.manager, def.name);
    await this.ensureQueue(def);
    const options: SendOptions = {
      ...queueOptions(def),
      ...(opts.singletonKey === undefined ? {} : { singletonKey: opts.singletonKey }),
      ...(opts.startAfter === undefined ? {} : { startAfter: opts.startAfter }),
      ...(db === undefined ? {} : { db }),
    };
    return this.host.boss.send(def.name, parsed.data, options);
  }

  /** Throws when the pg-boss schema is missing or the database is unreachable. */
  async assertQueueReady(): Promise<void> {
    if (!(await this.host.boss.isInstalled())) throw new Error('pg-boss is not installed');
  }

  /**
   * pg-boss only accepts jobs for existing queues. Creating one is idempotent; it runs once per
   * queue and process, on pg-boss's own connection (never inside the caller's transaction).
   */
  private ensureQueue(def: JobDef<object>): Promise<void> {
    let pending = this.queues.get(def.name);
    if (pending === undefined) {
      pending = this.host.boss.createQueue(def.name, queueOptions(def));
      void pending.catch(() => this.queues.delete(def.name));
      this.queues.set(def.name, pending);
    }
    return pending;
  }
}
