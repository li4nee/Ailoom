// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { RateLimit } from '../../common/security/rate-limit';
import { Public } from '../auth';
import { CurrentVisitor } from './current-visitor.decorator';
import type { CurrentVisitorData } from './widget-rate-limits';
import { WidgetService } from './widget.service';

/** One rating per closed conversation (spec §17.9). */
@Public()
@Controller('widget/v1/conversations/:conversationId/rating')
export class WidgetRatingController {
  constructor(private readonly widget: WidgetService) {}

  @Post()
  @RateLimit('visitorRating')
  @HttpCode(HttpStatus.NO_CONTENT)
  async create(
    @CurrentVisitor() visitor: CurrentVisitorData,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.widget.rateConversation(visitor, conversationId, body);
  }
}
