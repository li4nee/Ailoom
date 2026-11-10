// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { Job } from 'pg-boss';

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
        ...(this.options.pollingIntervalSeconds === undefined
          ? {}
          : { pollingIntervalSeconds: this.options.pollingIntervalSeconds }),
      },
      async (jobs: Job<unknown>[]) => {
        for (const job of jobs) {
          // A payload that no longer matches its schema fails the job like a handler error.
          const payload = def.schema.parse(job.data);
          await handler.handle(payload, {
            jobId: job.id,
            attempt: job.retryCount + 1,
            signal: job.signal,
          });
        }
      },
    );
    this.logger.log(`processing ${def.name} (concurrency ${String(def.concurrency)})`);
  }
}
