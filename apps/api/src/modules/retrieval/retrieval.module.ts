// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { UsageModule } from '../usage';
import { RetrievalRepository } from './retrieval.repository';
import { RetrievalService } from './retrieval.service';

/** Vector search for chat answers and the admin's test-retrieval panel (spec §13). */
@Module({
  imports: [UsageModule],
  providers: [RetrievalRepository, RetrievalService, { provide: Clock, useClass: SystemClock }],
  exports: [RetrievalRepository, RetrievalService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class RetrievalModule {}
