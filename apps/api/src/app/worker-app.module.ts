// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-extraneous-class */
import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs';
import { HeartbeatModule } from '../modules/instance/heartbeat.module';

/** Worker dependency graph — no HTTP layer, just jobs + heartbeat. */
@Module({
  imports: [JobsModule, HeartbeatModule],
})
export class WorkerAppModule {}
