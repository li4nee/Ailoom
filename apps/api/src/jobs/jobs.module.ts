// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-extraneous-class */
import { Module, Global } from '@nestjs/common';

import { Clock, SystemClock } from '../common/clock';
import { APP_CONFIG } from '../common/config';
import { ConfigModule } from '../common/config';
import { JobsService, PG_BOSS_TOKEN, createPgBossForApi } from './jobs.service';
import { JobsWorker } from './jobs.worker';

/** Job queue and worker dependency graph. */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PG_BOSS_TOKEN,
      useFactory: async (config: { database: { url: string } }) =>
        createPgBossForApi(config.database.url),
      inject: [APP_CONFIG],
    },
    JobsService,
    JobsWorker,
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [JobsService, PG_BOSS_TOKEN, JobsWorker, Clock],
})
export class JobsModule {}
