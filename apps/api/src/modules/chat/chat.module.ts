// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { Clock, SystemClock } from '../../common/clock';
import { BotsModule } from '../bots';
import { ConversationsModule } from '../conversations';
import { PromptsModule } from '../prompts';
import { RetrievalModule } from '../retrieval';
import { TracesModule } from '../traces';
import { UsageModule } from '../usage';
import { ChatOrchestrator } from './chat-orchestrator';
import { ChatPersistence } from './chat-persistence.service';
import { PlaygroundController } from './playground.controller';

/** The chat engine: persistence, decisions and the streaming orchestrator (spec §13, §14). */
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    BotsModule,
    ConversationsModule,
    PromptsModule,
    RetrievalModule,
    TracesModule,
    UsageModule,
  ],
  controllers: [PlaygroundController],
  providers: [ChatPersistence, ChatOrchestrator, { provide: Clock, useClass: SystemClock }],
  exports: [ChatPersistence, ChatOrchestrator],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class ChatModule {}
