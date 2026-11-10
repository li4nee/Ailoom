// SPDX-License-Identifier: AGPL-3.0-only
import 'reflect-metadata';

import { Injectable } from '@nestjs/common';

import type { JobDef } from './define-job';

/** What a handler learns about the attempt it is running. */
export interface JobContext {
  jobId: string;
  /** 1 for the first attempt, 2 for the first retry, … */
  attempt: number;
  /** Aborted when the job expires or the worker stops. */
  signal: AbortSignal;
}

/** A class decorated with `@JobProcessor(def)` processes the jobs of `def`. */
export interface JobHandler<P extends object> {
  handle(payload: P, ctx: JobContext): Promise<void>;
}

const JOB_PROCESSOR = Symbol('JOB_PROCESSOR');

/**
 * Marks a provider as the processor of `def`'s jobs. The worker finds every such provider at
 * startup and subscribes it with `concurrency` parallel jobs. Implies `@Injectable()`.
 */
export function JobProcessor<P extends object>(
  def: JobDef<P>,
): (target: new (...args: never[]) => JobHandler<P>) => void {
  return (target) => {
    Injectable()(target);
    Reflect.defineMetadata(JOB_PROCESSOR, def, target);
  };
}

/** The definition a class was decorated with, if any. */
export function getJobProcessorDef(target: object): JobDef<object> | undefined {
  const def: unknown = Reflect.getMetadata(JOB_PROCESSOR, target);
  return def === undefined ? undefined : (def as JobDef<object>);
}
