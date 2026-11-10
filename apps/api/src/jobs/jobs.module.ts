// SPDX-License-Identifier: AGPL-3.0-only
import { type DynamicModule, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { JobsService } from './jobs.service';
import { JOBS_WORKER_OPTIONS, JobsWorker, type JobsWorkerOptions } from './jobs.worker';
import { BOSS_ROLE, type BossRole, PgBossHost } from './pg-boss.host';

/**
 * pg-boss for the process. `forApi()` can only send jobs; `forWorker()` also processes every
 * `@JobProcessor` provider in the app. Needs the global `APP_CONFIG`.
 */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest dynamic module
export class JobsModule {
  static forApi(): DynamicModule {
    return JobsModule.build('api', []);
  }

  static forWorker(options: JobsWorkerOptions = {}): DynamicModule {
    return {
      ...JobsModule.build('worker', [
        JobsWorker,
        { provide: JOBS_WORKER_OPTIONS, useValue: options },
      ]),
      imports: [DiscoveryModule],
    };
  }

  private static build(role: BossRole, extra: DynamicModule['providers'] & object): DynamicModule {
    return {
      module: JobsModule,
      global: true,
      providers: [{ provide: BOSS_ROLE, useValue: role }, PgBossHost, JobsService, ...extra],
      exports: [JobsService],
    };
  }
}
