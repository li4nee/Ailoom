// SPDX-License-Identifier: AGPL-3.0-only
import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { DataSource } from 'typeorm';

import { type AppConfig, ConfigModule } from '../common/config';
import { buildLoggerOptions } from '../common/logging';
import { DatabaseModule } from '../db';
import { JobsModule, type JobsWorkerOptions } from '../jobs';
import { HeartbeatModule } from '../modules/instance';

export interface WorkerAppOverrides {
  /** An already initialized data source to use instead of opening a pool (test harness). */
  dataSource?: DataSource;
  jobs?: JobsWorkerOptions;
}

/**
 * The worker dependency graph: no HTTP layer. pg-boss runs every `@JobProcessor` provider
 * imported here; feature modules with processors are added as later tasks create them.
 */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest dynamic module
export class WorkerAppModule {
  static register(config: AppConfig, overrides: WorkerAppOverrides = {}): DynamicModule {
    return {
      module: WorkerAppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({ pinoHttp: buildLoggerOptions(config) }),
        DatabaseModule.forRoot(config, overrides.dataSource),
        JobsModule.forWorker(overrides.jobs),
        HeartbeatModule,
      ],
    };
  }
}
