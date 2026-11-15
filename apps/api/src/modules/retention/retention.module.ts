// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { JobsModule } from '../../jobs';
import { RetentionService } from './retention.service';

@Module({
  imports: [JobsModule.forApi()],
  providers: [{ provide: Clock, useClass: SystemClock }, RetentionService],
  exports: [RetentionService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class RetentionModule {}
