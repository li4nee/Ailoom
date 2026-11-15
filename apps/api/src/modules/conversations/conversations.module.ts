// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { ContactsRepository } from './contacts.repository';
import { ConversationsController } from './conversations.controller';
import { ConversationsRepository } from './conversations.repository';
import { ConversationsService } from './conversations.service';
import { InboxQuery } from './inbox.repository';
import { MessagesRepository } from './messages.repository';

/** Conversations, their messages and the visitors they belong to (spec §9.4). */
@Module({
  controllers: [ConversationsController],
  providers: [
    ConversationsRepository,
    MessagesRepository,
    ContactsRepository,
    InboxQuery,
    ConversationsService,
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [ConversationsRepository, MessagesRepository, ContactsRepository, ConversationsService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class ConversationsModule {}
