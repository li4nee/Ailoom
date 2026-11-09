// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import 'reflect-metadata';

import type { JobDef } from './define-job';

export const JOB_PROCESSOR = 'JOB_PROCESSOR';

/**
 * Interface for job processor classes.
 * Each processor must implement a `handle` method.
 */
export type JobProcessorClass<P extends JobDef> = new (...args: unknown[]) => {
  handle(payload: P['schema']['_output'], ctx: JobContext): Promise<void>;
};

/** Context provided to job handlers. */
export interface JobContext {
  /** Unique job identifier from pg-boss. */
  jobId: string;
  /** Current attempt number (1-based). */
  attempt: number;
  /** Signal that fires when the job should stop. */
  signal: AbortSignal;
}

/**
 * Decorator that marks a class as a job processor for the given job definition.
 *
 * The worker scans for this metadata at startup and subscribes to the job queue.
 */
export function JobProcessor(def: JobDef): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(JOB_PROCESSOR, { def }, target);
  };
}

/** Retrieves the job definition from a decorated processor class. */
export function getJobProcessorDef(target: object): { def: JobDef } | undefined {
  return Reflect.getMetadata(JOB_PROCESSOR, target);
}
