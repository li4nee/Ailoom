// SPDX-License-Identifier: AGPL-3.0-only
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { z } from 'zod';

import { defineJob, type JobContext, JobProcessor, JobsService } from '.';
import { getTestDataSource, resetDatabase } from '../../test/helpers/db';
import { WorkerAppModule } from '../app/worker-app.module';
import { loadConfig } from '../common/config';
import { AppError } from '../common/errors';
import { queueOptions } from './define-job';
import { PgBossHost } from './pg-boss.host';

const Echo = defineJob({
  name: 'test.echo',
  schema: z.object({ n: z.number() }),
  retryLimit: 2,
  retryBackoff: false,
  concurrency: 1,
});

const Flaky = defineJob({
  name: 'test.flaky',
  schema: z.object({ id: z.string() }),
  retryLimit: 2,
  retryBackoff: false,
  concurrency: 1,
});

/** Has retries to spare, so only a permanent failure keeps it from running again. */
const Strict = defineJob({
  name: 'test.strict',
  schema: z.object({ n: z.number() }),
  retryLimit: 3,
  retryBackoff: false,
  concurrency: 1,
});

const received: { n: number }[] = [];
const strictCalls: unknown[] = [];
const attempts = new Map<string, number[]>();

@JobProcessor(Echo)
class EchoProcessor {
  handle(payload: { n: number }): Promise<void> {
    received.push(payload);
    return Promise.resolve();
  }
}

/** Throws on its first two attempts, then succeeds. */
@JobProcessor(Flaky)
class FlakyProcessor {
  handle(payload: { id: string }, ctx: JobContext): Promise<void> {
    attempts.set(payload.id, [...(attempts.get(payload.id) ?? []), ctx.attempt]);
    if (ctx.attempt < 3) return Promise.reject(new Error(`attempt ${String(ctx.attempt)} fails`));
    return Promise.resolve();
  }
}

@JobProcessor(Strict)
class StrictProcessor {
  handle(payload: { n: number }): Promise<void> {
    strictCalls.push(payload);
    return Promise.resolve();
  }
}

let ds: DataSource;
let worker: INestApplicationContext;
let jobs: JobsService;

async function countJobs(name: string): Promise<number> {
  const [row] = await ds.query<{ count: number }[]>(
    'SELECT count(*)::int AS count FROM pgboss.job WHERE name = $1',
    [name],
  );
  return row?.count ?? 0;
}

beforeAll(async () => {
  ds = await getTestDataSource();
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: inject('databaseUrl'),
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
  });

  const app = WorkerAppModule.register(config, {
    dataSource: ds,
    jobs: { pollingIntervalSeconds: 0.5 },
  });
  worker = await NestFactory.createApplicationContext(
    {
      ...app,
      providers: [...(app.providers ?? []), EchoProcessor, FlakyProcessor, StrictProcessor],
    },
    { logger: false },
  );
  jobs = worker.get(JobsService);
});

afterAll(async () => {
  await worker.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
  received.length = 0;
  strictCalls.length = 0;
  attempts.clear();
});

describe('jobs', () => {
  it('drops jobs enqueued in a rolled-back transaction', async () => {
    await ds
      .transaction(async (m) => {
        await jobs.enqueue(Echo, { n: 1 }, { manager: m });
        throw new Error('rollback');
      })
      .catch(() => undefined);

    expect(await countJobs('test.echo')).toBe(0);
  });

  it('keeps jobs enqueued in a committed transaction', async () => {
    const id = await ds.transaction((m) => jobs.enqueue(Echo, { n: 2 }, { manager: m }));

    expect(id).toEqual(expect.any(String));
    await vi.waitFor(
      () => {
        expect(received).toEqual([{ n: 2 }]);
      },
      { timeout: 5_000 },
    );
  });

  it('delivers committed jobs with validated payloads', async () => {
    await jobs.enqueue(Echo, { n: 1 });

    await vi.waitFor(
      () => {
        expect(received).toEqual([{ n: 1 }]);
      },
      { timeout: 5_000 },
    );
  });

  it('refuses a manager that is not in a transaction instead of enqueuing outside one', async () => {
    // A DataSource's own manager has no query runner: the job would commit on its own, and a
    // rollback of the caller's writes would leave it behind.
    await expect(jobs.enqueue(Echo, { n: 3 }, { manager: ds.manager })).rejects.toThrow(AppError);
    expect(await countJobs('test.echo')).toBe(0);

    // A query runner that has not started a transaction commits the job just the same.
    const runner = ds.createQueryRunner();
    try {
      await expect(jobs.enqueue(Echo, { n: 3 }, { manager: runner.manager })).rejects.toThrow(
        AppError,
      );
    } finally {
      await runner.release();
    }
    expect(await countJobs('test.echo')).toBe(0);
  });

  it('rejects invalid payloads at enqueue time', async () => {
    await expect(jobs.enqueue(Echo, { n: 'x' } as never)).rejects.toThrow(AppError);
    expect(await countJobs('test.echo')).toBe(0);
  });

  it('retries until retryLimit', async () => {
    await jobs.enqueue(Flaky, { id: 'a' });

    await vi.waitFor(
      async () => {
        const [row] = await ds.query<{ state: string }[]>(
          `SELECT state FROM pgboss.job WHERE name = 'test.flaky'`,
        );
        expect(row?.state).toBe('completed');
      },
      { timeout: 15_000, interval: 200 },
    );
    expect(attempts.get('a')).toEqual([1, 2, 3]);
  });

  it('fails a job whose stored payload no longer matches its schema, without retrying', async () => {
    // Bypasses enqueue-time validation, as a job written by an older release would.
    const boss = worker.get(PgBossHost).boss;
    await boss.createQueue(Strict.name, queueOptions(Strict));
    await boss.send(Strict.name, { n: 'not a number' }, queueOptions(Strict));

    await vi.waitFor(
      async () => {
        const [row] = await ds.query<{ state: string; retry_count: number }[]>(
          `SELECT state, retry_count FROM pgboss.job WHERE name = 'test.strict'`,
        );
        expect(row).toEqual({ state: 'failed', retry_count: 0 });
      },
      { timeout: 10_000, interval: 200 },
    );
    expect(strictCalls).toEqual([]);
  });
});
