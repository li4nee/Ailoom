// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { Clock } from '../../common/clock';
import { asWorkspaceId } from '../../db/ids';
import { type JobHandler, JobProcessor } from '../../jobs';
import { EmailService } from '../email';
import { AGENT_REPLY_EMAIL_JOB } from './agent-reply-email.job';
import { ContactsRepository } from './contacts.repository';
import { ConversationsRepository } from './conversations.repository';
import { InboxQuery } from './inbox.repository';
import { MessagesRepository } from './messages.repository';
import { VisitorPresence } from './visitor-presence';

type Payload = z.infer<typeof AGENT_REPLY_EMAIL_JOB.schema>;

/**
 * Sends one email containing every agent reply since the previous email, if the visitor is not
 * connected to the conversation at processing time. `contacts.last_emailed_at` is the
 * high-water mark, so a later job cannot repeat a reply the visitor already received.
 */
@JobProcessor(AGENT_REPLY_EMAIL_JOB)
@Injectable()
export class AgentReplyEmailProcessor implements JobHandler<Payload> {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly contacts: ContactsRepository,
    private readonly messages: MessagesRepository,
    private readonly inbox: InboxQuery,
    private readonly presence: VisitorPresence,
    private readonly email: EmailService,
    private readonly clock: Clock,
  ) {}

  async handle(payload: Payload): Promise<void> {
    const workspaceId = asWorkspaceId(payload.workspaceId);
    if (!this.email.isEnabled()) return;
    if (this.presence.isConnected(payload.conversationId)) return;

    const conversation = await this.conversations.findById(workspaceId, payload.conversationId);
    if (conversation === null) return;
    const contact = await this.contacts.findById(workspaceId, conversation.contactId);
    if (contact?.email === null || contact?.email === undefined) return;

    const replies = await this.messages.listAgentMessagesSince(
      workspaceId,
      conversation.id,
      contact.lastEmailedAt,
    );
    if (replies.length === 0) return;

    const row = await this.inbox.detail(workspaceId, conversation.id);
    if (row === null) return;

    await this.email.send('agent_reply', contact.email, {
      workspaceId,
      conversationId: conversation.id,
      botName: row.bot_name,
      messages: replies.map((message) => ({
        authorName: 'Support agent',
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
    });

    const newest = replies.at(-1);
    if (newest !== undefined) {
      await this.contacts.updateById(workspaceId, contact.id, {
        lastEmailedAt: newest.createdAt,
      });
    } else {
      await this.contacts.updateById(workspaceId, contact.id, {
        lastEmailedAt: this.clock.now(),
      });
    }
  }
}
