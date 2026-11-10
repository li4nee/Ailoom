// SPDX-License-Identifier: AGPL-3.0-only
import type { QueueOptions } from 'pg-boss';
import type { z } from 'zod';

/** What a job is called, what its payload looks like, and how pg-boss retries and runs it. */
export interface JobDefinition<P extends object> {
  /** The pg-boss queue name, e.g. `knowledge.ingest`. */
  name: string;
  /** Validates the payload at enqueue time and again when the worker receives it. */
  schema: z.ZodType<P>;
  /** Retries after the first attempt; 0 = no retry. */
  retryLimit: number;
  /** Exponential backoff from `retryDelaySec` (1 s when unset). */
  retryBackoff: boolean;
  /** Delay before a retry, in seconds. pg-boss default: 0. */
  retryDelaySec?: number;
  /** Jobs of this kind one worker process runs at once. */
  concurrency: number;
  /** How long an attempt may run before pg-boss fails it. pg-boss default: 15 minutes. */
  expireInSec?: number;
}

export type JobDef<P extends object> = Readonly<JobDefinition<P>>;

const QUEUE_NAME = /^[\w.\-/]+$/;

function assertCount(value: number, min: number, what: string, name: string): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`Job ${name}: ${what} must be an integer >= ${String(min)}`);
  }
}

/** Declares a job. Definitions are module-level constants shared by producers and processors. */
export function defineJob<P extends object>(def: JobDefinition<P>): JobDef<P> {
  if (!QUEUE_NAME.test(def.name)) throw new Error(`Invalid job name: ${def.name}`);
  assertCount(def.retryLimit, 0, 'retryLimit', def.name);
  assertCount(def.concurrency, 1, 'concurrency', def.name);
  if (def.retryDelaySec !== undefined) assertCount(def.retryDelaySec, 0, 'retryDelaySec', def.name);
  if (def.expireInSec !== undefined) assertCount(def.expireInSec, 1, 'expireInSec', def.name);
  return Object.freeze({ ...def });
}

/** The pg-boss queue (and per-job) options that carry a definition's retry policy. */
export function queueOptions(def: JobDef<object>): QueueOptions {
  return {
    retryLimit: def.retryLimit,
    retryBackoff: def.retryBackoff,
    ...(def.retryDelaySec === undefined ? {} : { retryDelay: def.retryDelaySec }),
    ...(def.expireInSec === undefined ? {} : { expireInSeconds: def.expireInSec }),
  };
}
