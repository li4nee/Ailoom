// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { UsageModule } from '../usage';
import { ReportsController } from './reports.controller';
import { TracesController } from './traces.controller';
import { TracesRepository } from './traces.repository';
import { TracesService } from './traces.service';

/** Generation traces and their replay view (spec §9.5, §17.8). */
@Module({
  imports: [UsageModule],
  controllers: [TracesController, ReportsController],
  providers: [TracesRepository, TracesService],
  exports: [TracesRepository, TracesService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class TracesModule {}
