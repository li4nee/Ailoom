// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { SavedRepliesController } from './saved-replies.controller';
import { SavedRepliesRepository } from './saved-replies.repository';
import { SavedRepliesService } from './saved-replies.service';

@Module({
  controllers: [SavedRepliesController],
  providers: [
    SavedRepliesRepository,
    SavedRepliesService,
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [SavedRepliesService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class SavedRepliesModule {}
