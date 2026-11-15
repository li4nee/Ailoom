// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { CHAT_HANDOFF_REQUESTED, type ChatHandoffRequestedEvent } from '../../events';
import { EmailService } from '../email';
import { UsageRepository } from '../usage';
import { InboxQuery } from './inbox.repository';

/**
 * Emails the workspace when a conversation needs a person (spec §17.7). The event is emitted
 * after the handoff transaction commits; without a configured transport the listener is a
 * no-op, so a handoff still works on an instance that sends no email.
 */
@Injectable()
export class HandoffNotifierListener {
  constructor(
    private readonly inbox: InboxQuery,
    private readonly usage: UsageRepository,
    private readonly email: EmailService,
  ) {}

  @OnEvent(CHAT_HANDOFF_REQUESTED)
  async handle(event: ChatHandoffRequestedEvent): Promise<void> {
    if (!this.email.isEnabled()) return;

    const context = await this.inbox.handoffNotificationContext(
      event.workspaceId,
      event.conversationId,
    );
    if (context === null) return;

    const recipients = await this.usage.alertRecipients(event.workspaceId);
    for (const to of recipients) {
      await this.email.send('handoff_requested', to, {
        workspaceId: event.workspaceId,
        conversationId: event.conversationId,
        botName: context.bot_name,
        reason: context.handoff_reason,
        contactEmail: context.contact_email,
        lastMessage: context.last_visitor_message,
      });
    }
  }
}
