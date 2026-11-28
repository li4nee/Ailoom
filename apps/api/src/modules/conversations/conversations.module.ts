// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { ActiveStreamsModule } from '../../common/active-streams';
import { Clock, SystemClock } from '../../common/clock';
import { AgentAssistModule } from '../agent-assist';
import { UsageModule } from '../usage';
import { MembershipsRepository } from '../workspaces';
import { AgentActionsController } from './agent-actions.controller';
import { AgentActionsService } from './agent-actions.service';
import { AgentOperationsController } from './agent-operations.controller';
import { AgentOperationsProcessor } from './agent-operations.processor';
import { AgentOperationsRepository } from './agent-operations.repository';
import { AgentOperationsSchedule } from './agent-operations.schedule';
import { AgentOperationsService } from './agent-operations.service';
import { AgentReplyEmailProcessor } from './agent-reply-email.processor';
import { ContactsRepository } from './contacts.repository';
import { ConversationsController } from './conversations.controller';
import { ConversationsRepository } from './conversations.repository';
import { ConversationsService } from './conversations.service';
import { HandoffNotifierListener } from './handoff-notifier.listener';
import { InboxQuery } from './inbox.repository';
import { InternalNotesController } from './internal-notes.controller';
import { InternalNotesRepository } from './internal-notes.repository';
import { InternalNotesService } from './internal-notes.service';
import { MessagesRepository } from './messages.repository';
import { VisitorPresence } from './visitor-presence';

/** Conversations, their messages and the visitors they belong to (spec §9.4). */
@Module({
  imports: [ActiveStreamsModule, UsageModule, AgentAssistModule],
  controllers: [
    ConversationsController,
    AgentActionsController,
    AgentOperationsController,
    InternalNotesController,
  ],
  providers: [
    AgentActionsService,
    AgentOperationsRepository,
    AgentOperationsService,
    AgentOperationsProcessor,
    AgentOperationsSchedule,
    AgentReplyEmailProcessor,
    HandoffNotifierListener,
    VisitorPresence,
    ConversationsRepository,
    MessagesRepository,
    ContactsRepository,
    InboxQuery,
    InternalNotesRepository,
    InternalNotesService,
    ConversationsService,
    MembershipsRepository,
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [
    AgentActionsService,
    ConversationsRepository,
    MessagesRepository,
    ContactsRepository,
    ConversationsService,
    VisitorPresence,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class ConversationsModule {}
