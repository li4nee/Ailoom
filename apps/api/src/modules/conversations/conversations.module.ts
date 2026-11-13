// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { ContactsRepository } from './contacts.repository';
import { ConversationsRepository } from './conversations.repository';
import { MessagesRepository } from './messages.repository';

/** Conversations, their messages and the visitors they belong to (spec §9.4). */
@Module({
  providers: [
    ConversationsRepository,
    MessagesRepository,
    ContactsRepository,
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [ConversationsRepository, MessagesRepository, ContactsRepository],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class ConversationsModule {}
