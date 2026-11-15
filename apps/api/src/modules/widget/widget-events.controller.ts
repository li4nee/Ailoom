// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, Headers, Inject, Param, Res } from '@nestjs/common';
import type { NodeResponse } from '@nestjs/platform-node';

import type { RealtimeEvent } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { Public } from '../auth';
import { MessagesRepository } from '../conversations';
import { openSse, RealtimeHub, SSE_HEARTBEAT_MS, type SseStream } from '../realtime';
import { CurrentVisitor } from './current-visitor.decorator';
import type { CurrentVisitorData } from './widget-rate-limits';
import { toWidgetMessage } from './widget.mapper';
import { WidgetService } from './widget.service';

/**
 * `GET /api/widget/v1/conversations/:conversationId/events` (spec §17.9, §18.3): agent replies
 * and conversation status changes for one visitor conversation. `Last-Event-ID` replays the
 * messages the widget missed while its stream was down; the live channel then only ever sends
 * complete messages, so an in-progress answer placeholder never appears as a second bubble.
 */
@Public()
@Controller('widget/v1/conversations/:conversationId/events')
export class WidgetEventsController {
  constructor(
    private readonly widget: WidgetService,
    private readonly messages: MessagesRepository,
    private readonly hub: RealtimeHub,
    @Inject(SSE_HEARTBEAT_MS) private readonly heartbeatMs: number,
  ) {}

  @Get()
  async stream(
    @CurrentVisitor() visitor: CurrentVisitorData,
    @Param('conversationId') conversationId: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Res() reply: NodeResponse,
  ): Promise<void> {
    const claims = visitor.claims;
    await this.widget.ownConversation(visitor, conversationId);

    const sse = openSse(reply, { heartbeatMs: this.heartbeatMs });

    if (lastEventId !== undefined && lastEventId !== '') {
      const missed = await this.messages.listAfterId(
        claims.workspaceId,
        conversationId,
        lastEventId,
      );
      for (const message of missed) {
        if (message.status === 'complete') {
          sse.send('message', toWidgetMessage(message), message.id);
        }
      }
    }

    const unsubscribe = this.hub.subscribe(
      claims.workspaceId,
      (event) => this.relevant(event, conversationId),
      (event) => {
        this.deliver(event, conversationId, sse, claims.workspaceId);
      },
    );
    sse.onClose(unsubscribe);
  }

  private relevant(event: RealtimeEvent, conversationId: string): boolean {
    if (event.type === 'resync') return true;
    if (event.type === 'message.created' || event.type === 'conversation.updated') {
      return event.conversationId === conversationId;
    }
    return false;
  }

  private deliver(
    event: RealtimeEvent,
    conversationId: string,
    sse: SseStream,
    workspaceId: WorkspaceId,
  ): void {
    if (event.type === 'resync') {
      sse.send('resync', {});
      return;
    }
    if (event.type === 'conversation.updated') {
      sse.send('status', { status: event.status });
      return;
    }
    if (event.type === 'message.created') {
      void this.sendMessage(event.messageId, conversationId, sse, workspaceId);
    }
  }

  /** The notification is small; the widget needs the whole message, so read it back. */
  private async sendMessage(
    messageId: string,
    conversationId: string,
    sse: SseStream,
    workspaceId: WorkspaceId,
  ): Promise<void> {
    try {
      const message = await this.messages.findById(workspaceId, messageId);
      if (message?.conversationId !== conversationId || message.status !== 'complete') {
        return;
      }
      sse.send('message', toWidgetMessage(message), message.id);
    } catch {
      // The stream is best effort: a vanished row must not take the API down.
    }
  }
}
