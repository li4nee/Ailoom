// SPDX-License-Identifier: AGPL-3.0-only
import type { ZodType } from 'zod';

/** Job payload validated by `schema`. */
export type JobPayload<T> = T extends ZodType<infer U> ? U : never;

/** Options controlling retries and concurrency for a job definition. */
export interface JobOptions {
  /** Maximum number of attempts (1 = no retry). */
  retryLimit: number;
  /** Exponential backoff between retries. */
  retryBackoff: boolean;
  /** Fixed delay in seconds between retries when `retryBackoff` is false. */
  retryDelaySec?: number;
  /** How many workers can process this job in parallel. */
  concurrency: number;
  /** Job expires after this many seconds (pg-boss `expireIn`). */
  expireInSec?: number;
}

/** Complete job definition returned by `defineJob`. */
export interface JobDef<T extends ZodType> {
  readonly name: string;
  readonly schema: T;
  readonly options: JobOptions;
}

/**
 * Creates a type-safe job definition.
 *
 * The returned object carries the Zod schema at runtime so `JobsService.enqueue`
 * can validate the payload before handing it to pg-boss.
 */
export function defineJob<T extends ZodType>(def: {
  name: string;
  schema: T;
  retryLimit: number;
  retryBackoff: boolean;
  retryDelaySec?: number;
  concurrency: number;
  expireInSec?: number;
}): JobDef<T> {
  return {
    name: def.name,
    schema: def.schema,
    options: {
      retryLimit: def.retryLimit,
      retryBackoff: def.retryBackoff,
      retryDelaySec: def.retryDelaySec,
      concurrency: def.concurrency,
      expireInSec: def.expireInSec,
    },
  };
}
