// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db';
import { JobsModule } from '../../jobs';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/** Health check endpoints (liveness + readiness). */
@Module({
  imports: [JobsModule, DatabaseModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class HealthModule {
  // Static module class - no instance members needed
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}
}
