// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { ChallengeController } from './challenge.controller';
import { ChallengeService } from './challenge.service';
import { VisitorTokenService } from './visitor-token.service';

/**
 * The widget HTTP surface. `VisitorTokenService` is exported for the visitor guard that later
 * tasks (5.2–5.7) hang their controllers off this module. `ChallengeService` and
 * `ChallengeController` implement the proof-of-work challenge endpoint (Task 5.3).
 */
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }, VisitorTokenService, ChallengeService],
  controllers: [ChallengeController],
  exports: [VisitorTokenService, ChallengeService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class WidgetModule {}
