// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import type { NodeResponse } from '@nestjs/platform-node';
import type { ZodError } from 'zod';

import { sendMessageSchema } from '@app/shared';

import { AppError } from '../../common/errors';
import { RateLimit } from '../../common/security/rate-limit';
import { Public } from '../auth';
import { ChatOrchestrator, SseAnswerSink, VISITOR_MESSAGE_MAX } from '../chat';
import { openSse } from '../realtime';
import { CurrentVisitor } from './current-visitor.decorator';
import type { CurrentVisitorData } from './widget-rate-limits';
import { WidgetService } from './widget.service';

function validationError(error: ZodError): AppError {
  return new AppError('validation_failed', {
    details: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

/** A message over the limit is a `message_too_long`, not a generic validation failure. */
function contentTooLong(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const content = (body as { content?: unknown }).content;
  return typeof content === 'string' && content.trim().length > VISITOR_MESSAGE_MAX;
}

/**
 * `POST /api/widget/v1/conversations/:conversationId/messages` (spec §17.9, §18.2): the
 * visitor's message and the streamed answer. The conversation must belong to the token's
 * contact and bot; an id from anywhere else is a plain 404.
 */
@Public()
@Controller('widget/v1/conversations/:conversationId/messages')
export class WidgetMessagesController {
  constructor(
    private readonly widget: WidgetService,
    private readonly orchestrator: ChatOrchestrator,
  ) {}

  @Post()
  @RateLimit('visitorMessage')
  async send(
    @CurrentVisitor() visitor: CurrentVisitorData,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
    @Res() reply: NodeResponse,
  ): Promise<void> {
    const claims = this.widget.claimsOf(visitor);
    // 404 before reading the body: a stranger cannot learn whether an id exists, and a
    // conversation of another contact or bot in the same workspace is indistinguishable from
    // a missing one.
    await this.widget.ownConversation(visitor, conversationId);

    // The content limit is checked before the stream opens, so the widget gets a normal 400
    // instead of a 200 SSE with a single error event.
    if (contentTooLong(body)) throw new AppError('message_too_long');
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);

    const sse = openSse(reply);
    const controller = new AbortController();
    sse.onClose(() => {
      controller.abort();
    });

    try {
      await this.orchestrator.handle(
        {
          workspaceId: claims.workspaceId,
          botId: claims.botId,
          mode: {
            kind: 'widget',
            conversationId,
            content: parsed.data.content,
          },
          signal: controller.signal,
        },
        new SseAnswerSink(sse, { includeTrace: false }),
      );
    } finally {
      sse.close();
    }
  }
}
