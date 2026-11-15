// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { AdminMessage, AgentMessageRequest, ConversationStatus } from '@app/shared';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import type { UserId, WorkspaceId } from '../../db/ids';
import { ActiveStreams } from '../chat/active-streams';
import { notifyWorkspace } from '../realtime';
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
    private readonly activeStreams: ActiveStreams,
    private readonly clock: Clock,
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
