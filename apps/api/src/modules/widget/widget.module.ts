// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { ConversationsModule } from '../conversations';
import { UsageModule } from '../usage';
import { ChallengeController } from './challenge.controller';
import { ChallengeService } from './challenge.service';
import { VisitorTokenService } from './visitor-token.service';
import { WidgetConversationsController } from './widget-conversations.controller';
import { WidgetSessionsController } from './widget-sessions.controller';
import { WidgetService } from './widget.service';

/**
 * The widget HTTP surface. `VisitorTokenService` is exported for the visitor guard the HTTP app
 * registers globally. `ChallengeService`/`ChallengeController` issue and verify proof-of-work
 * challenges (Task 5.3); `WidgetService` backs sessions, config and conversations (Task 5.4),
 * and the message/handoff/events controllers of Tasks 5.5–5.7 extend it here.
 */
@Module({
  imports: [ConversationsModule, UsageModule],
  providers: [
    { provide: Clock, useClass: SystemClock },
    VisitorTokenService,
    ChallengeService,
    WidgetService,
  ],
  controllers: [ChallengeController, WidgetSessionsController, WidgetConversationsController],
  exports: [VisitorTokenService, ChallengeService, WidgetService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class WidgetModule {}
