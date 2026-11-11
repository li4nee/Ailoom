// SPDX-License-Identifier: AGPL-3.0-only
import { type DynamicModule, Module } from '@nestjs/common';
import { ClsModule, ClsServiceManager } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import type { DataSource } from 'typeorm';

import { type AppConfig, ConfigModule } from '../common/config';
import { buildLoggerOptions } from '../common/logging';
import { DatabaseModule } from '../db';
import { JobsModule, type JobsWorkerOptions } from '../jobs';
import { CredentialsModule, CredentialsService } from '../modules/credentials';
import { CredentialsReencryptModule } from '../modules/credentials/reencrypt.module';
import { EmailModule, type Mailer } from '../modules/email';
import { HeartbeatModule } from '../modules/instance';
import { WorkspacePurgeModule } from '../modules/workspaces/workspace-purge.module';
import { ProvidersModule } from '../providers';

export interface WorkerAppOverrides {
  /** An already initialized data source to use instead of opening a pool (test harness). */
  dataSource?: DataSource;
  jobs?: JobsWorkerOptions;
  /** Bind a fixed mailer (e.g. a recording one) instead of the configured transport. */
  mailer?: Mailer;
}

/**
 * The worker dependency graph: no HTTP layer. pg-boss runs every `@JobProcessor` provider
 * imported here; feature modules with processors are added as later tasks create them. CLS
 * is global so each job runs under a store that carries its `jobId` for the logs.
 */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest dynamic module
export class WorkerAppModule {
  static register(config: AppConfig, overrides: WorkerAppOverrides = {}): DynamicModule {
    return {
      module: WorkerAppModule,
      imports: [
        ConfigModule.forRoot(config),
        // Global: feature modules inject PinoLogger (e.g. the email module) without importing.
        // Job logs carry the current job's id from the CLS store. pino-http's customProps only
        // runs for HTTP request logs, and the worker has none; pino's mixin runs on every line.
        {
          ...LoggerModule.forRoot({
            pinoHttp: {
              ...buildLoggerOptions(config),
              mixin: () => {
                const cls = ClsServiceManager.getClsService();
                if (!cls.isActive()) return {};
                const jobId = cls.get<string | undefined>('jobId');
                return jobId === undefined ? {} : { jobId };
              },
            },
          }),
          global: true,
        },
        ClsModule.forRoot({ global: true }),
        DatabaseModule.forRoot(config, overrides.dataSource),
        JobsModule.forWorker(overrides.jobs),
        EmailModule.forRoot(overrides.mailer === undefined ? {} : { mailer: overrides.mailer }),
        HeartbeatModule,
        WorkspacePurgeModule,
        CredentialsModule,
        CredentialsReencryptModule,
        // Embedding jobs in later milestones reach models through the same resolver.
        ProvidersModule.forRoot({ imports: [CredentialsModule], resolver: CredentialsService }),
      ],
    };
  }
}
