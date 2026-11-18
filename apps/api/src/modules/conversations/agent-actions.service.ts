// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { AdminMessage, AgentMessageRequest, ConversationStatus } from '@app/shared';

import { ActiveStreams } from '../../common/active-streams';
import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import type { UserId, WorkspaceId } from '../../db/ids';
import { JobsService } from '../../jobs';
import { OutboxService } from '../integrations';
import { notifyWorkspace } from '../realtime';
import { AGENT_REPLY_EMAIL_JOB } from './agent-reply-email.job';
import { ContactsRepository } from './contacts.repository';
import { toAdminMessage } from './conversations.mapper';
import { ConversationsRepository } from './conversations.repository';
import { nextStatus, type ConversationAction } from './domain/transitions';
import type { ConversationEntity } from './entities/conversation.entity';
import { InboxQuery } from './inbox.repository';
import { MessagesRepository } from './messages.repository';

/**
 * The agent's write paths on a conversation (spec §17.7). Every action locks the conversation
 * row, applies the transition table, writes the `system` message that records the change and
 * notifies the workspace in the same transaction. The realtime event is therefore never
 * delivered for a rolled-back action, and a second agent sees the first agent's assignment.
 */
@Injectable()
export class AgentActionsService {
  constructor(
    private readonly ds: DataSource,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly inbox: InboxQuery,
    private readonly contacts: ContactsRepository,
    private readonly activeStreams: ActiveStreams,
    private readonly jobs: JobsService,
    private readonly clock: Clock,
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  async reply(
    workspaceId: WorkspaceId,
    conversationId: string,
    actorUserId: UserId,
    body: AgentMessageRequest,
  ): Promise<AdminMessage> {
    const authorName = await this.displayName(actorUserId);

    const message = await this.ds.transaction(async (manager) => {
      const conversation = await this.lock(workspaceId, conversationId, manager);
      await this.assertNotOwnedByOther(conversation, actorUserId);

      let status: ConversationStatus = conversation.status;
      if (conversation.status !== 'human') {
        await this.transition(workspaceId, conversationId, actorUserId, 'agent_message', manager);
        status = 'human';
      }

      // One millisecond after the system message written by `transition`, so the timeline
      // (created_at, id) always shows "joined" before the first reply.
      const messageAt = new Date(this.clock.now().getTime() + 1);
      const inserted = await this.messages.insert(
        workspaceId,
        {
          conversationId,
          role: 'agent',
          authorUserId: actorUserId,
          content: body.content,
          status: 'complete',
          createdAt: messageAt,
        },
        manager,
      );
      await this.conversations.updateById(
        workspaceId,
        conversationId,
        { lastMessageAt: messageAt },
        manager,
      );
      await notifyWorkspace(manager, workspaceId, {
        type: 'message.created',
        conversationId,
        messageId: inserted.id,
        role: 'agent',
      });
      if (this.outbox !== undefined) {
        await this.outbox.record(
          workspaceId,
          {
            type: 'message.created',
            aggregateId: inserted.id,
            idempotencyKey: `message:${inserted.id}`,
            data: {
              conversationId,
              messageId: inserted.id,
              role: 'agent',
              status: inserted.status,
            },
          },
          manager,
        );
      }

      // Spec §17.7: three quick replies become one delayed email. The job shares this
      // transaction, so a rolled-back reply never schedules an email.
      const contact = await this.contacts.findById(workspaceId, conversation.contactId, manager);
      if (contact?.email !== null && contact?.email !== undefined) {
        await this.jobs.enqueue(
          AGENT_REPLY_EMAIL_JOB,
          { workspaceId, conversationId },
          { manager, singletonKey: conversationId, startAfter: 60 },
        );
      }
      if (status !== conversation.status) {
        await notifyWorkspace(manager, workspaceId, {
          type: 'conversation.updated',
          conversationId,
          botId: conversation.botId,
          status,
        });
      }
      return inserted;
    });

    // After commit: the visitor stops seeing AI tokens before the agent's reply arrives.
    this.activeStreams.abort(conversationId);
    return toAdminMessage(message, null, authorName);
  }

  async takeOver(
    workspaceId: WorkspaceId,
    conversationId: string,
    actorUserId: UserId,
  ): Promise<ConversationStatus> {
    const status = await this.ds.transaction(async (manager) => {
      const conversation = await this.lock(workspaceId, conversationId, manager);
      await this.assertNotOwnedByOther(conversation, actorUserId);
      // A repeated takeover by the owner is idempotent, so a retried request is not a 409.
      if (conversation.status === 'human') return conversation.status;

      const updated = await this.transition(
        workspaceId,
        conversationId,
        actorUserId,
        'takeover',
        manager,
      );
      return updated.status;
    });

    this.activeStreams.abort(conversationId);
    return status;
  }

  async handBack(
    workspaceId: WorkspaceId,
    conversationId: string,
    actorUserId: UserId,
  ): Promise<ConversationStatus> {
    const status = await this.ds.transaction(async (manager) => {
      await this.lock(workspaceId, conversationId, manager);
      const updated = await this.transition(
        workspaceId,
        conversationId,
        actorUserId,
        'handback',
        manager,
      );
      return updated.status;
    });

    this.activeStreams.abort(conversationId);
    return status;
  }

  async close(
    workspaceId: WorkspaceId,
    conversationId: string,
    actorUserId: UserId,
  ): Promise<ConversationStatus> {
    const status = await this.ds.transaction(async (manager) => {
      const conversation = await this.lock(workspaceId, conversationId, manager);
      if (conversation.status === 'closed') return conversation.status;
      const updated = await this.transition(
        workspaceId,
        conversationId,
        actorUserId,
        'close',
        manager,
      );
      return updated.status;
    });

    this.activeStreams.abort(conversationId);
    return status;
  }

  /**
   * Applies one transition and its system message. The caller already holds the row lock and
   * has checked ownership, so this is the only place that writes the status columns.
   */
  private async transition(
    workspaceId: WorkspaceId,
    conversationId: string,
    actorUserId: UserId,
    action: ConversationAction,
    manager: EntityManager,
  ): Promise<ConversationEntity> {
    const conversation = await this.lock(workspaceId, conversationId, manager);
    const status = nextStatus(conversation.status, action);
    const now = this.clock.now();
    const authorName = await this.displayName(actorUserId);
    const target: 'human' | 'ai' | 'closed' =
      status === 'closed' ? 'closed' : status === 'ai' ? 'ai' : 'human';

    const updated = await this.conversations.updateById(
      workspaceId,
      conversationId,
      {
        status,
        ...(target === 'human' ? { assignedUserId: actorUserId, closedAt: null } : {}),
        ...(target === 'ai' ? { assignedUserId: null, closedAt: null } : {}),
        ...(target === 'closed' ? { closedAt: now } : {}),
        ...(target === 'human' && conversation.status === 'ai'
          ? { handoffReason: 'agent_takeover' }
          : {}),
        lastMessageAt: now,
      },
      manager,
    );

    const content = this.systemMessage(action, authorName);
    const system = await this.messages.insert(
      workspaceId,
      {
        conversationId,
        role: 'system',
        content,
        status: 'complete',
        createdAt: now,
      },
      manager,
    );
    await notifyWorkspace(manager, workspaceId, {
      type: 'message.created',
      conversationId,
      messageId: system.id,
      role: 'system',
    });
    await notifyWorkspace(manager, workspaceId, {
      type: 'conversation.updated',
      conversationId,
      botId: conversation.botId,
      status,
    });
    if (this.outbox !== undefined) {
      await this.outbox.record(
        workspaceId,
        {
          type: 'conversation.updated',
          aggregateId: conversationId,
          idempotencyKey: `conversation:${conversationId}:transition:${system.id}`,
          data: { conversationId, botId: conversation.botId, status },
        },
        manager,
      );
      if (target === 'human' && conversation.status === 'ai') {
        await this.outbox.record(
          workspaceId,
          {
            type: 'handoff.requested',
            aggregateId: conversationId,
            idempotencyKey: `handoff:${conversationId}:${system.id}`,
            data: { conversationId, reason: updated.handoffReason ?? 'agent_takeover' },
          },
          manager,
        );
      }
      if (target === 'closed') {
        await this.outbox.record(
          workspaceId,
          {
            type: 'conversation.closed',
            aggregateId: conversationId,
            idempotencyKey: `conversation:${conversationId}:closed:${system.id}`,
            data: { conversationId, reason: action },
          },
          manager,
        );
      }
    }
    return updated;
  }

  private systemMessage(action: ConversationAction, authorName: string): string {
    switch (action) {
      case 'takeover':
      case 'agent_message':
        return `${authorName} joined the conversation.`;
      case 'handback':
        return `${authorName} handed the conversation back to the assistant.`;
      case 'close':
        return `${authorName} closed the conversation.`;
    }
  }

  private async lock(
    workspaceId: WorkspaceId,
    conversationId: string,
    manager: EntityManager,
  ): Promise<ConversationEntity> {
    return this.conversations.lockForUpdate(workspaceId, conversationId, manager);
  }

  private async assertNotOwnedByOther(
    conversation: ConversationEntity,
    actorUserId: UserId,
  ): Promise<void> {
    const ownerId = conversation.assignedUserId;
    if (ownerId === null || ownerId === actorUserId) return;
    const ownerName = (await this.inbox.authorsByIds([ownerId])).get(ownerId) ?? 'Another agent';
    throw new AppError('already_assigned', {
      message: `Another agent already owns this conversation: ${ownerName}.`,
      details: [{ path: 'assignedTo', message: ownerName }],
    });
  }

  private async displayName(userId: UserId): Promise<string> {
    const names = await this.inbox.authorsByIds([userId]);
    return names.get(userId) ?? 'An agent';
  }
}
