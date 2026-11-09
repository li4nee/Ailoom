// SPDX-License-Identifier: AGPL-3.0-only
import { Module, Global } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Clock, SystemClock } from '../../common/clock';
import { HeartbeatService } from './heartbeat.service';

/** Worker heartbeat registration and monitoring. */
@Global()
@Module({
  providers: [
    {
      provide: 'CLOCK',
      useClass: SystemClock,
    },
    {
      provide: HeartbeatService,
      useFactory: (ds: DataSource, clock: Clock) => new HeartbeatService(ds, clock),
      inject: [DataSource, 'CLOCK'],
    },
  ],
  exports: [HeartbeatService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class HeartbeatModule {
  // Static module class - no instance members needed
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}
}
