// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ReadinessRepository } from './readiness.repository';

/** Liveness and readiness. Needs the global `DataSource` and `JobsService`. */
@Module({ controllers: [HealthController], providers: [HealthService, ReadinessRepository] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class HealthModule {}
