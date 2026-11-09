// SPDX-License-Identifier: AGPL-3.0-only
import {
  PgBoss,
  type ConstructorOptions,
  type SendOptions as PgBossSendOptions,
  type QueueOptions,
  type WorkOptions as PgBossWorkOptions,
  type IDatabase,
  type StopOptions,
} from 'pg-boss';

/**
 * Branded type for pg-boss job IDs.
 * Ensures type safety when passing job IDs around.
 */
export type JobId = string & { readonly __brand: unique symbol };

/**
 * Branded type for pg-boss queue names.
 * Ensures type safety when referencing queues.
 */
export type QueueName = string & { readonly __brand: unique symbol };

/**
 * Creates a branded JobId from a string.
 */
export function createJobId(id: string): JobId {
  return id as JobId;
}

/**
 * Creates a branded QueueName from a string.
 */
export function createQueueName(name: string): QueueName {
  return name as QueueName;
}

/**
 * Narrowed job data interface that replaces pg-boss's `Job<any>`.
 * Provides type-safe access to job properties.
 */
export interface PgBossJobData<T> {
  readonly id: JobId;
  readonly name: string;
  readonly data: T;
  readonly state: 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed';
  readonly priority: number;
  readonly retryCount: number;
  readonly retryLimit: number;
  readonly retryBackoff: boolean;
  readonly retryDelay: number;
  readonly singletonKey: string | null;
  readonly singletonOn: 'job' | 'queue' | null;
  readonly expireIn: number | null;
  readonly startAfter: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly failedAt: Date | null;
  readonly output: null;
}

/**
 * Type-safe send options that extend pg-boss's SendOptions.
 */
export interface SendOptions {
  /** Maximum number of retry attempts (1 = no retry). */
  retryLimit?: number;
  /** Use exponential backoff for retries. */
  retryBackoff?: boolean;
  /** Fixed delay in milliseconds between retries when retryBackoff is false. */
  retryDelay?: number;
  /** Ensures only one pending job with this key exists. */
  singletonKey?: string;
  /** Schedule the job for the future (milliseconds from now). */
  startAfter?: number;
  /** Job expires after this many milliseconds. */
  expireIn?: number;
  /** Priority of the job (higher = more important). */
  priority?: number;
}

/**
 * Type-safe work options for subscribing to a queue.
 */
export interface WorkOptions {
  /** Number of workers that can process this queue in parallel. */
  teamSize?: number;
}

/**
 * Type-safe create queue options.
 */
export interface CreateQueueOptions {
  /** Number of workers that can process this queue in parallel. */
  teamSize?: number;
  /** Maximum number of retry attempts for jobs in this queue. */
  retryLimit?: number;
  /** Use exponential backoff for retries. */
  retryBackoff?: boolean;
  /** Fixed delay in milliseconds between retries. */
  retryDelay?: number;
  /** Default priority for jobs in this queue. */
  priority?: number;
}

/**
 * Handler function type for processing jobs.
 */
export type PgBossWorkHandlerFn<T = unknown> = (job: PgBossJobData<T>) => Promise<void>;

/**
 * Type-safe wrapper around PgBoss that provides fully typed methods.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-floating-promises */
export class TypedPgBoss {
  constructor(private readonly boss: PgBoss) {}

  /**
   * Starts the pg-boss instance.
   */
  async start(): Promise<void> {
    await this.boss.start();
  }

  /**
   * Stops the pg-boss instance gracefully.
   */
  async stop(options?: { gracePeriod?: number }): Promise<void> {
    const stopOptions: StopOptions = options ? { gracePeriod: options.gracePeriod } : undefined;
    await this.boss.stop(stopOptions);
  }

  /**
   * Sends a job to a queue with type-safe payload.
   */
  async send(queue: QueueName, data: unknown, options?: SendOptions): Promise<JobId | null> {
    const pgBossOptions: PgBossSendOptions = {
      retryLimit: options?.retryLimit,
      retryBackoff: options?.retryBackoff,
      retryDelay: options?.retryDelay,
      singletonKey: options?.singletonKey,
      startAfter: options?.startAfter,
      expireIn: options?.expireIn,
      priority: options?.priority,
    };

    const jobId = await this.boss.send(queue as string, data, pgBossOptions);
    return jobId ? createJobId(jobId) : null;
  }

  /**
   * Sends a job within a database transaction.
   */
  async sendWithTransaction(
    queue: QueueName,
    data: unknown,
    dbAdapter: IDatabase,
    options?: SendOptions,
  ): Promise<JobId | null> {
    const pgBossOptions: PgBossSendOptions = {
      retryLimit: options?.retryLimit,
      retryBackoff: options?.retryBackoff,
      retryDelay: options?.retryDelay,
      singletonKey: options?.singletonKey,
      startAfter: options?.startAfter,
      expireIn: options?.expireIn,
      priority: options?.priority,
    };

    const jobId = await this.boss.send(queue as string, data, pgBossOptions, { db: dbAdapter });
    return jobId ? createJobId(jobId) : null;
  }

  /**
   * Creates a queue with type-safe options.
   */
  async createQueue(queue: QueueName, options?: CreateQueueOptions): Promise<void> {
    const pgBossOptions: Omit<QueueOptions, 'name'> = {
      teamSize: options?.teamSize,
      retryLimit: options?.retryLimit,
      retryBackoff: options?.retryBackoff,
      retryDelay: options?.retryDelay,
      priority: options?.priority,
    };

    await this.boss.createQueue(queue, pgBossOptions);
  }

  /**
   * Subscribes to a queue (prepares workers).
   */
  async subscribe(queue: QueueName): Promise<void> {
    await this.boss.subscribe(queue);
  }

  /**
   * Registers a work handler for a queue with type-safe job data.
   */
  work<T>(queue: QueueName, handler: PgBossWorkHandlerFn<T>, options?: WorkOptions): void {
    const workOptions: PgBossWorkOptions = {
      teamSize: options?.teamSize,
    };

    this.boss.work(queue, workOptions, async (jobs) => {
      const jobArray = Array.isArray(jobs) ? jobs : [jobs];
      for (const job of jobArray) {
        const rawJob = job as Record<string, unknown>;
        const typedJob: PgBossJobData<T> = {
          id: createJobId(String(rawJob['id'])),
          name: String(rawJob['name']),
          data: rawJob['data'] as T,
          state: rawJob['state'] as
            'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed',
          priority: Number(rawJob['priority']),
          retryCount: Number(rawJob['retryCount']),
          retryLimit: Number(rawJob['retryLimit']),
          retryBackoff: Boolean(rawJob['retryBackoff']),
          retryDelay: Number(rawJob['retryDelay']),
          singletonKey: rawJob['singletonKey'] as string | null,
          singletonOn: rawJob['singletonOn'] as 'job' | 'queue' | null,
          expireIn: rawJob['expireIn'] as number | null,
          startAfter: rawJob['startAfter'] as number | null,
          createdAt: rawJob['createdAt'] as Date,
          updatedAt: rawJob['updatedAt'] as Date,
          startedAt: rawJob['startedAt'] as Date | null,
          completedAt: rawJob['completedAt'] as Date | null,
          failedAt: rawJob['failedAt'] as Date | null,
          output: rawJob['output'] as null,
        };
        await handler(typedJob);
      }
    });
  }

  /**
   * Gets the size of a queue.
   */
  async getQueueSize(queue?: QueueName): Promise<number> {
    const stats = await this.boss.getQueueStats(queue as string | undefined);
    if (stats.length > 0) {
      return Number(stats[0].count);
    }
    return 0;
  }

  /**
   * Gets the raw pg-boss instance for advanced use cases.
   * Use sparingly and prefer typed methods.
   */
  getRaw(): PgBoss {
    return this.boss;
  }
}

/**
 * Factory function to create a type-safe pg-boss instance for the API (send-only).
 */
export async function createApiPgBoss(databaseUrl: string): Promise<TypedPgBoss> {
  const options: ConstructorOptions = {
    connectionString: databaseUrl,
    maintenance: {
      supervise: false,
      migrate: true,
    },
    scheduling: {
      schedule: false,
    },
  };
  const boss = new PgBoss(options);
  await boss.start();
  return new TypedPgBoss(boss);
}

/**
 * Factory function to create a type-safe pg-boss instance for the worker (full features).
 */
export async function createWorkerPgBoss(databaseUrl: string): Promise<TypedPgBoss> {
  const options: ConstructorOptions = {
    connectionString: databaseUrl,
    maintenance: {
      supervise: true,
      migrate: true,
    },
    scheduling: {
      schedule: true,
    },
  };
  const boss = new PgBoss(options);
  await boss.start();
  return new TypedPgBoss(boss);
}

/**
 * Provider token for the typed pg-boss instance.
 */
export const TYPED_PG_BOSS_TOKEN = 'TYPED_PG_BOSS';
