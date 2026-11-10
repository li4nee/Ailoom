// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { Job, JobResult } from 'pg-boss';

import { type JobDef, queueOptions } from './define-job';
import { getJobProcessorDef, type JobHandler } from './job-processor.decorator';
import { PgBossHost } from './pg-boss.host';

export interface JobsWorkerOptions {
  /** How often an idle worker polls each queue. pg-boss default: 2 s. */
  pollingIntervalSeconds?: number;
}

export const JOBS_WORKER_OPTIONS = Symbol('JOBS_WORKER_OPTIONS');

function isJobHandler(value: unknown): value is JobHandler<object> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'handle' in value &&
    typeof value.handle === 'function'
  );
}

/** Subscribes every `@JobProcessor` provider of the app to its queue. Worker process only. */
@Injectable()
export class JobsWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('JobsWorker');

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly host: PgBossHost,
    @Inject(JOBS_WORKER_OPTIONS) private readonly options: JobsWorkerOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const wrapper of this.discovery.getProviders()) {
      const metatype = wrapper.metatype;
      const instance: unknown = wrapper.instance;
      // Value and factory providers have no class to carry the decorator.
      if (typeof metatype !== 'function') continue;
      const def = getJobProcessorDef(metatype);
      if (def === undefined) continue;
      if (!isJobHandler(instance)) {
        throw new Error(`@JobProcessor(${def.name}) ${metatype.name} has no handle() method`);
      }
      await this.subscribe(def, instance);
    }
  }

  private async subscribe(def: JobDef<object>, handler: JobHandler<object>): Promise<void> {
    await this.host.boss.createQueue(def.name, queueOptions(def));
    await this.host.boss.work(
      def.name,
      {
        localConcurrency: def.concurrency,
        batchSize: 1,
        // Lets the handler settle each job itself, so an invalid payload can fail for good
        // (below) while a handler error still throws and retries per the job definition.
        perJobResults: true,
        ...(this.options.pollingIntervalSeconds === undefined
          ? {}
          : { pollingIntervalSeconds: this.options.pollingIntervalSeconds }),
      },
      async (jobs: Job<unknown>[]): Promise<JobResult[]> => {
        const results: JobResult[] = [];
        for (const job of jobs) {
          const parsed = def.schema.safeParse(job.data);
          if (!parsed.success) {
            // Retrying cannot fix a payload that does not match its schema, so the job ends
            // here: `deadletter` skips the remaining retries (it is plain `failed` when the
            // queue has no dead letter queue). The issues are kept on the job as its output.
            this.logger.error(
              `${def.name} job ${job.id} has an invalid payload and will not be retried`,
            );
            results.push({
              id: job.id,
              status: 'deadletter',
              output: { message: 'Invalid job payload', issues: parsed.error.issues },
            });
            continue;
          }
          await handler.handle(parsed.data, {
            jobId: job.id,
            attempt: job.retryCount + 1,
            signal: job.signal,
          });
          results.push({ id: job.id, status: 'completed' });
        }
        return results;
      },
    );
    this.logger.log(`processing ${def.name} (concurrency ${String(def.concurrency)})`);
  }
}
