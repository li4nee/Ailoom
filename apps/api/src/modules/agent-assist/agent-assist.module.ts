// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { AuditModule } from '../audit';
import { RetrievalModule } from '../retrieval';
import { UsageModule } from '../usage';
import { AgentAssistSettingsService } from './agent-assist-settings.service';
import { AgentAssistController, AgentAssistOperationsController } from './agent-assist.controller';
import { AgentAssistRepository } from './agent-assist.repository';
import { AgentAssistService } from './agent-assist.service';
import { HandoffSummaryListener } from './handoff-summary.listener';
import { HandoffSummaryProcessor } from './handoff-summary.processor';
import { ReplySuggestionsService } from './reply-suggestions.service';

@Module({
  imports: [AuditModule, UsageModule, RetrievalModule],
  controllers: [AgentAssistController, AgentAssistOperationsController],
  providers: [
    AgentAssistRepository,
    AgentAssistService,
    AgentAssistSettingsService,
    ReplySuggestionsService,
    HandoffSummaryListener,
    HandoffSummaryProcessor,
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [AgentAssistService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class AgentAssistModule {}
