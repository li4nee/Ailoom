// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-type-parameters */
import { Inject, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

import { APP_CONFIG } from '../common/config';
import { type AppConfig } from '../common/config';
import { getJobProcessorDef, JobContext, type JobDef } from './job-processor.decorator';
import {
  TypedPgBoss,
  type CreateQueueOptions,
  type WorkOptions,
  type QueueName,
  createWorkerPgBoss,
} from './pg-boss-wrapper';

/** Internal registry of discovered job processors. */
interface RegisteredProcessor<P extends JobDef> {
  def: P;
  instance: { handle(payload: P['schema']['_output'], ctx: JobContext): Promise<void> };
}

@Injectable()
export class JobsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly processors: RegisteredProcessor<JobDef>[] = [];
  private boss: TypedPgBoss | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Registers a processor class discovered via `@JobProcessor`. */
  registerProcessor<P extends JobDef>(
    def: P,
    instance: { handle(payload: P['schema']['_output'], ctx: JobContext): Promise<void> },
  ): void {
    this.processors.push({ def, instance });
  }

  /** Subscribes to all registered processors. */
  private async subscribeAll(): Promise<void> {
    if (!this.boss) return;
    for (const { def, instance } of this.processors) {
      const queueName = def.name as QueueName;
      const workOptions: WorkOptions = { teamSize: def.options.concurrency };

      await this.boss.subscribe(queueName, workOptions);

      this.boss.work(
        queueName,
        async (typedJob) => {
          const ctx: JobContext = {
            jobId: typedJob.id,
            attempt: typedJob.retryCount + 1,
            signal: AbortSignal.none, // pg-boss doesn't provide a native abort signal
          };

          await instance.handle(typedJob.data, ctx);
        },
        workOptions,
      );
    }
  }

  async onModuleInit(): Promise<void> {
    this.boss = await createWorkerPgBoss(this.config.database.url);
    await this.subscribeAll();
  }

  /** Subscribes to a newly registered processor dynamically. */
  async subscribeProcessor<P extends JobDef>(
    def: P,
    instance: { handle(payload: P['schema']['_output'], ctx: JobContext): Promise<void> },
  ): Promise<void> {
    if (!this.boss) return;
    // Ensure queue exists before registering handler
    const queueName = def.name as QueueName;
    const createQueueOptions: CreateQueueOptions = {
      teamSize: def.options.concurrency,
      retryLimit: def.options.retryLimit,
      retryBackoff: def.options.retryBackoff,
      retryDelay:
        def.options.retryBackoff && def.options.retryDelaySec
          ? def.options.retryDelaySec * 1000
          : 0,
    };

    await this.boss.createQueue(queueName, createQueueOptions);

    const workOptions: WorkOptions = { teamSize: def.options.concurrency };

    this.boss.work(
      queueName,
      async (typedJob) => {
        const ctx: JobContext = {
          jobId: typedJob.id,
          attempt: typedJob.retryCount + 1,
          signal: AbortSignal.none,
        };

        await instance.handle(typedJob.data, ctx);
      },
      workOptions,
    );
  }

  /** Creates a queue without registering a handler. */
  async createQueue(def: JobDef): Promise<void> {
    if (!this.boss) return;
    const queueName = def.name as QueueName;
    const createQueueOptions: CreateQueueOptions = { teamSize: def.options.concurrency };
    await this.boss.createQueue(queueName, createQueueOptions);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.boss) {
      // Wait up to 30 seconds for graceful shutdown
      await this.boss.stop({ gracePeriod: 30_000 });
    }
    // Clear processors to allow fresh registration on re-init
    this.processors.length = 0;
  }
}

/** Provider that collects all `@JobProcessor` classes and registers them with `JobsWorker`. */
@Injectable()
export class JobProcessorRegistrar implements OnModuleInit {
  constructor(
    private readonly jobsWorker: JobsWorker,
    // Processors are provided via the module's `providers` array
  ) {}

  async onModuleInit(): Promise<void> {
    // Processors are registered via the module's provider list
    // They are instantiated by Nest and their metadata is read here
  }
}

/** Helper to register a processor instance with the worker. */
export function registerJobProcessor<P extends JobDef>(
  jobsWorker: JobsWorker,
  target: object,
  instance: { handle(payload: P['schema']['_output'], ctx: JobContext): Promise<void> },
): void {
  const meta = getJobProcessorDef(target);
  if (!meta) {
    throw new Error(`Class ${target.constructor.name} is not decorated with @JobProcessor`);
  }
  jobsWorker.registerProcessor(meta.def, instance);
}
