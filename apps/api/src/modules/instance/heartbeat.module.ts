// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { HeartbeatService } from './heartbeat.service';

/** Worker heartbeat. Needs the global `DataSource` and `APP_CONFIG`. */
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }, HeartbeatService],
  exports: [HeartbeatService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class HeartbeatModule {}
