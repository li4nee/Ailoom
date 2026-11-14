// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Post } from '@nestjs/common';

import type { SessionResponse, WidgetConfig } from '@app/shared';

import { RateLimit } from '../../common/security/rate-limit';
import { Public } from '../auth';
import { CurrentVisitor } from './current-visitor.decorator';
import type { CurrentVisitorData } from './widget-rate-limits';
import { WidgetService } from './widget.service';

/**
 * `POST /api/widget/v1/sessions` and `GET /api/widget/v1/config` (spec §10.4, §17.9). Both are
 * reached by the page before a conversation exists; the visitor guard has already checked the
 * bot, the origin and (for the config read) the visitor token.
 */
@Public()
@Controller('widget/v1')
export class WidgetSessionsController {
  constructor(private readonly widget: WidgetService) {}

  @Post('sessions')
  @RateLimit('widgetSession')
  async createSession(
    @CurrentVisitor() visitor: CurrentVisitorData,
    @Body() body: unknown,
  ): Promise<SessionResponse> {
    return this.widget.createSession(visitor, body);
  }

  @Get('config')
  config(@CurrentVisitor() visitor: CurrentVisitorData): WidgetConfig {
    return this.widget.config(visitor.bot);
  }
}
