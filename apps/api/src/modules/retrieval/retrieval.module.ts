// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { BotsModule } from '../bots';
import { UsageModule } from '../usage';
import { RetrievalRepository } from './retrieval.repository';
import { RetrievalService } from './retrieval.service';
import { TestRetrievalController } from './test-retrieval.controller';

/** Vector search for chat answers and the admin's test-retrieval panel (spec §13). */
@Module({
  imports: [BotsModule, UsageModule],
  controllers: [TestRetrievalController],
  providers: [RetrievalRepository, RetrievalService, { provide: Clock, useClass: SystemClock }],
  exports: [RetrievalRepository, RetrievalService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class RetrievalModule {}
