// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { ActiveStreamsModule } from '../chat/active-streams.module';
import { AgentActionsController } from './agent-actions.controller';
import { AgentActionsService } from './agent-actions.service';
import { ContactsRepository } from './contacts.repository';
import { ConversationsController } from './conversations.controller';
import { ConversationsRepository } from './conversations.repository';
import { ConversationsService } from './conversations.service';
import { InboxQuery } from './inbox.repository';
import { MessagesRepository } from './messages.repository';

/** Conversations, their messages and the visitors they belong to (spec §9.4). */
@Module({
  imports: [ActiveStreamsModule],
  controllers: [ConversationsController, AgentActionsController],
  providers: [
    AgentActionsService,
    ConversationsRepository,
    MessagesRepository,
    ContactsRepository,
    InboxQuery,
    ConversationsService,
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [
    AgentActionsService,
    ConversationsRepository,
    MessagesRepository,
    ContactsRepository,
    ConversationsService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class ConversationsModule {}
