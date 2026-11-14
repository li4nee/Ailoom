// SPDX-License-Identifier: AGPL-3.0-only
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { NodeResponse } from '@nestjs/platform-node';

import type { ConversationStatus, WidgetConversation } from '@app/shared';

import { Public } from '../auth';
import { CurrentVisitor } from './current-visitor.decorator';
import type { CurrentVisitorData } from './widget-rate-limits';
import { WidgetService } from './widget.service';

/**
 * The visitor's conversation surface (spec §17.9). `current` is what the widget opens into;
 * `create` starts a new conversation when there is none, or when the visitor asks for one.
 */
@Public()
@Controller('widget/v1/conversations')
export class WidgetConversationsController {
  constructor(private readonly widget: WidgetService) {}

  /**
   * Explicitly emits JSON `null` when there is no conversation: returning null from the
   * handler makes Nest end the response with an empty body, which the widget's `res.json()`
   * cannot parse.
   */
  @Get('current')
  async current(
    @CurrentVisitor() visitor: CurrentVisitorData,
    @Res() response: NodeResponse,
  ): Promise<void> {
    const conversation = await this.widget.current(visitor);
    response.status(HttpStatus.OK).json(conversation);
  }

  @Post(':conversationId/handoff')
  @HttpCode(HttpStatus.OK)
  async handoff(
    @CurrentVisitor() visitor: CurrentVisitorData,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
  ): Promise<{ status: ConversationStatus; handoffMessage: string }> {
    return this.widget.handoff(visitor, conversationId, body);
  }

  @Post()
  async create(
    @CurrentVisitor() visitor: CurrentVisitorData,
    @Body() body: unknown,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<WidgetConversation> {
    return this.widget.createConversation(visitor, body, userAgent ?? null);
  }
}
