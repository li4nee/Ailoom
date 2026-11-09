// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-explicit-any */
import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { AppError } from '../common/errors';
import { type JobDef, type JobPayload } from './define-job';
import {
  TypedPgBoss,
  type SendOptions,
  type QueueName,
  createApiPgBoss,
  createWorkerPgBoss,
} from './pg-boss-wrapper';

/** Options accepted by `enqueue`. */
export interface EnqueueOptions {
  /** When provided, the job is created inside the caller's transaction. */
  manager?: EntityManager;
  /** Ensures only one pending job with this key exists (pg-boss `singletonKey`). */
  singletonKey?: string;
  /** Schedule the job for the future (Date or milliseconds from now). */
  startAfter?: Date | number;
}

const PG_BOSS = 'PG_BOSS';

@Injectable()
export class JobsService {
  constructor(@Inject(PG_BOSS) private readonly boss: TypedPgBoss) {}

  /**
   * Enqueues a job with a validated payload.
   *
   * When `manager` is provided, the job is inserted in the same transaction.
   * Otherwise a new transaction is used.
   */
  async enqueue<P extends JobDef>(
    def: P,
    payload: JobPayload<P['schema']>,
    opts: EnqueueOptions = {},
  ): Promise<string | null> {
    // Validate payload against the schema
    const result = def.schema.safeParse(payload);
    if (!result.success) {
      throw new AppError('internal_error', {
        message: `Invalid payload for job ${def.name}: ${result.error.message}`,
      });
    }

    const jobOptions: SendOptions = {
      retryLimit: def.options.retryLimit,
      retryBackoff: def.options.retryBackoff,
      ...(def.options.retryBackoff && def.options.retryDelaySec
        ? { retryDelay: def.options.retryDelaySec * 1000 }
        : {}),
      singletonKey: opts.singletonKey,
      startAfter: opts.startAfter as number | undefined,
      expireIn: def.options.expireInSec ? def.options.expireInSec * 1000 : undefined,
    };

    const queueName = def.name as QueueName;

    if (opts.manager) {
      // Use the caller's transaction via pg-boss's db adapter
      return this.boss.sendWithTransaction(queueName, payload, opts.manager as any, jobOptions);
    }

    return this.boss.send(queueName, payload, jobOptions);
  }
}

/** Provider token for the pg-boss instance. */
export const PG_BOSS_TOKEN = PG_BOSS;

/** Creates the pg-boss instance used by the API (send-only). */
export async function createPgBossForApi(databaseUrl: string): Promise<TypedPgBoss> {
  return createApiPgBoss(databaseUrl);
}

/** Creates the fully-featured pg-boss instance used by the worker. */
export async function createPgBossForWorker(databaseUrl: string): Promise<TypedPgBoss> {
  return createWorkerPgBoss(databaseUrl);
}
