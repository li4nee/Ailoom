// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { Public } from '../auth';
import { CurrentVisitor } from './current-visitor.decorator';
import type { CurrentVisitorData } from './widget-rate-limits';
import { WidgetService } from './widget.service';

/** `POST /api/widget/v1/messages/:messageId/feedback` (spec §17.9). */
@Public()
@Controller('widget/v1/messages/:messageId/feedback')
export class WidgetFeedbackController {
  constructor(private readonly widget: WidgetService) {}

  /** 204: the widget only needs to know the thumbs landed. */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async create(
    @CurrentVisitor() visitor: CurrentVisitorData,
    @Param('messageId') messageId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.widget.feedback(visitor, messageId, body);
  }
}
