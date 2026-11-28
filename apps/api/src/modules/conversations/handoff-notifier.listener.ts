// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import { CHAT_HANDOFF_REQUESTED, type ChatHandoffRequestedEvent } from '../../events';
import { NotificationsService } from '../notifications';
import { UsageRepository } from '../usage';
import { AgentOperationsService } from './agent-operations.service';
import { InboxQuery } from './inbox.repository';

/**
 * Emails the workspace when a conversation needs a person (spec §17.7). The event is emitted
 * after the handoff transaction commits; without a configured transport the listener is a
 * no-op, so a handoff still works on an instance that sends no email.
 */
@Injectable()
export class HandoffNotifierListener {
  constructor(
    private readonly ds: DataSource,
    private readonly inbox: InboxQuery,
    private readonly usage: UsageRepository,
    @Optional() private readonly operations?: AgentOperationsService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  @OnEvent(CHAT_HANDOFF_REQUESTED)
  async handle(event: ChatHandoffRequestedEvent): Promise<void> {
    await this.operations?.routeHandoff(event.workspaceId, event.conversationId);
    const context = await this.inbox.handoffNotificationContext(
      event.workspaceId,
      event.conversationId,
    );
    if (context === null) return;
    const notifications = this.notifications;
    if (notifications === undefined) return;

    const recipients = await this.usage.alertRecipients(event.workspaceId);
    await this.ds.transaction((manager) =>
      notifications.notify(manager, {
        type: 'handoff_requested',
        workspaceId: event.workspaceId,
        conversationId: event.conversationId,
        botId: event.botId,
        botName: context.bot_name,
        reason: context.handoff_reason,
        contactEmail: context.contact_email,
        lastMessage: context.last_visitor_message,
        actorUserId: null,
        legacyRecipients: recipients,
      }),
    );
  }
}
