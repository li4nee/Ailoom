// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-empty-function, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createTestApp } from '../../test/helpers/app';
import { resetDatabase, getTestDataSource } from '../../test/helpers/db';
import { type AppConfig, loadConfig } from '../common/config';
import { JobsService, JobsWorker, JobContext } from '../jobs';

let t: Awaited<ReturnType<typeof createTestApp>>;
let ds: DataSource;
let config: AppConfig;

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'w'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
  LOG_LEVEL: 'error',
};

beforeAll(async () => {
  config = loadConfig(TEST_ENV);
  const testDs = await getTestDataSource();
  const databaseUrl = testDs.options.url as string;
  const testConfig = {
    ...config,
    database: { ...config.database, url: databaseUrl, listenUrl: databaseUrl },
  };
  t = await createTestApp({ config: testConfig });
  ds = t.ds;
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
});

const EchoSchema = z.object({ n: z.number() });

describe('jobs framework', () => {
  let worker: JobsWorker;

  beforeAll(async () => {
    worker = t.app.get(JobsWorker);
    await worker.onModuleInit();
  });

  afterAll(async () => {
    await worker.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(ds);
    // Recreate pg-boss instance to clear internal cache
    await worker.onModuleDestroy();
    await worker.onModuleInit();
  });

  it('drops jobs enqueued in a rolled-back transaction', async () => {
    const { defineJob } = await import('../jobs');

    const Echo = defineJob({
      name: 'test.echo.rollback',
      schema: EchoSchema,
      retryLimit: 2,
      retryBackoff: false,
      concurrency: 1,
    });

    const jobsService = t.app.get(JobsService);

    await ds
      .transaction(async (m) => {
        await jobsService.enqueue(Echo, { n: 1 }, { manager: m });
        throw new Error('rollback');
      })
      .catch(() => {});

    const count = await ds.query<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM pgboss.job WHERE name = 'test.echo.rollback'`,
    );
    expect(parseInt(count[0]?.count ?? '0', 10)).toBe(0);
  });

  it('delivers committed jobs with validated payloads', async () => {
    const { defineJob, JobProcessor } = await import('../jobs');

    const Echo = defineJob({
      name: 'test.echo.deliver',
      schema: EchoSchema,
      retryLimit: 2,
      retryBackoff: false,
      concurrency: 1,
    });

    const received: { n: number }[] = [];

    @JobProcessor(Echo)
    class EchoProcessor {
      async handle(payload: { n: number }, _ctx: JobContext): Promise<void> {
        received.push(payload);
      }
    }

    // Register the processor with the worker
    const { registerJobProcessor } = await import('../jobs');
    const processorInstance = new EchoProcessor();
    registerJobProcessor(worker, EchoProcessor, processorInstance);
    await worker.subscribeProcessor(Echo, processorInstance);

    const jobsService = t.app.get(JobsService);
    await jobsService.enqueue(Echo, { n: 1 });

    // Give the worker time to process
    await vi.waitFor(
      async () => {
        const count = await ds.query<{ count: string }[]>(
          `SELECT count(*)::text AS count FROM pgboss.job WHERE name = 'test.echo.deliver' AND state = 'completed'`,
        );
        if (parseInt(count[0]?.count ?? '0', 10) === 0) throw new Error('not completed');
      },
      { timeout: 5000, interval: 100 },
    );

    expect(received).toEqual([{ n: 1 }]);
  });

  it('rejects invalid payloads at enqueue time', async () => {
    const { defineJob } = await import('../jobs');

    const Echo = defineJob({
      name: 'test.echo.invalid',
      schema: EchoSchema,
      retryLimit: 2,
      retryBackoff: false,
      concurrency: 1,
    });

    const jobsService = t.app.get(JobsService);

    await expect(jobsService.enqueue(Echo, { n: 'x' })).rejects.toThrow();
  });

  it('retries until retryLimit', async () => {
    const { defineJob, JobProcessor } = await import('../jobs');

    const Flaky = defineJob({
      name: 'test.flaky.retry',
      schema: z.object({ shouldFail: z.boolean() }),
      retryLimit: 1, // pg-boss only retries once in test env
      retryBackoff: false,
      concurrency: 1,
    });

    let attempts = 0;

    @JobProcessor(Flaky)
    class FlakyProcessor {
      async handle(payload: { shouldFail: boolean }, _ctx: JobContext): Promise<void> {
        attempts++;
        if (attempts < 2 && payload.shouldFail) {
          throw new Error('intentional failure');
        }
      }
    }

    // Register the processor with the worker
    const { registerJobProcessor } = await import('../jobs');
    const processorInstance = new FlakyProcessor();
    registerJobProcessor(worker, FlakyProcessor, processorInstance);
    await worker.subscribeProcessor(Flaky, processorInstance);

    const jobsService = t.app.get(JobsService);
    await jobsService.enqueue(Flaky, { shouldFail: true });

    await vi.waitFor(
      async () => {
        const job = await ds.query<{ retry_count: string }[]>(
          `SELECT retry_count FROM pgboss.job WHERE name = 'test.flaky.retry'`,
        );
        if (job.length === 0 || parseInt(job[0]?.retry_count ?? '0', 10) < 1) {
          throw new Error('not retried enough');
        }
      },
      { timeout: 5000, interval: 100 },
    );

    expect(attempts).toBe(2);
  });
});
