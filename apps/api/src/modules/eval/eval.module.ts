// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit';
import { BotsModule } from '../bots';
import { ChatModule } from '../chat';
import { CredentialsModule } from '../credentials';
import { PromptsModule } from '../prompts';
import { UsageModule } from '../usage';
import { DatasetsController } from './datasets.controller';
import { DatasetsRepository } from './datasets.repository';
import { DatasetsService } from './datasets.service';
import { EvalCaseProcessor } from './eval-case.processor';
import { EvalRunProcessor } from './eval-run.processor';
import { RunsController } from './runs.controller';
import { RunsRepository } from './runs.repository';
import { RunsService } from './runs.service';

@Module({
  imports: [AuditModule, BotsModule, CredentialsModule, PromptsModule, ChatModule, UsageModule],
  controllers: [DatasetsController, RunsController],
  providers: [
    DatasetsRepository,
    DatasetsService,
    RunsRepository,
    RunsService,
    EvalRunProcessor,
    EvalCaseProcessor,
  ],
  exports: [DatasetsRepository, DatasetsService, RunsRepository, RunsService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class EvalModule {}
