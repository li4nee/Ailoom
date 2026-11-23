// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type {
  AdminMessage,
  AgentMessageRequest,
  ConversationAssignmentRequest,
  ConversationAssignmentResponse,
  ConversationPriorityRequest,
  ConversationPriorityResponse,
  ConversationStatus,
  Role,
} from '@app/shared';

import { ActiveStreams } from '../../common/active-streams';
import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { newId } from '../../common/ids';
import type { UserId, WorkspaceId } from '../../db/ids';
import { JobsService } from '../../jobs';
import { AuditService } from '../audit';
import { OutboxService } from '../integrations';
import { CRM_CONTEXT_JOB } from '../integrations/crm-context.job';
import { notifyWorkspace } from '../realtime';
import { MembershipsRepository } from '../workspaces';
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
    private readonly audit: AuditService,
    private readonly memberships: MembershipsRepository,
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  async assign(
    workspaceId: WorkspaceId,
    conversationId: string,
    actorUserId: UserId,
    body: ConversationAssignmentRequest,
  ): Promise<ConversationAssignmentResponse> {
    const nameIds =
      body.assignedUserId === null
        ? [actorUserId]
        : [...new Set([actorUserId, body.assignedUserId as UserId])];
    const names = await this.inbox.authorsByIds(nameIds);
    const actorName = names.get(actorUserId) ?? 'An agent';
    const targetName =
      body.assignedUserId === null ? null : (names.get(body.assignedUserId) ?? 'An agent');

    const result = await this.ds.transaction(async (manager) => {
      const conversation = await this.lock(workspaceId, conversationId, manager);
      if (conversation.lastWorkflowMutationId === body.mutationId) {
        return {
          assignedUserId: conversation.assignedUserId,
          status: conversation.status,
          workflowVersion: conversation.workflowVersion,
          changed: false,
        };
      }

      const memberIds = [
        actorUserId,
        ...(body.assignedUserId === null ? [] : [body.assignedUserId]),
      ];
      const roles = await this.memberships.lockRoles(workspaceId, memberIds, manager);
      const actorRole = roles.get(actorUserId);
      if (actorRole === undefined) throw new AppError('not_found');
      if (body.assignedUserId !== null && !roles.has(body.assignedUserId)) {
        throw new AppError('not_found');
      }

      this.assertAssignmentAllowed(conversation, actorUserId, actorRole, body.assignedUserId);
      if (conversation.workflowVersion !== body.expectedWorkflowVersion) {
        throw new AppError('stale_conversation');
      }

      const nextStatus: ConversationStatus =
        body.assignedUserId !== null &&
        (conversation.status === 'ai' || conversation.status === 'needs_human')
          ? 'human'
          : conversation.status;
      if (
        conversation.assignedUserId === body.assignedUserId &&
        conversation.status === nextStatus
      ) {
        return {
          assignedUserId: conversation.assignedUserId,
          status: conversation.status,
          workflowVersion: conversation.workflowVersion,
          changed: false,
        };
      }

      const statusChanged = nextStatus !== conversation.status;
      const now = this.clock.now();
      const updated = await this.conversations.updateById(
        workspaceId,
        conversationId,
        {
          assignedUserId: body.assignedUserId,
          status: nextStatus,
          workflowVersion: () => '"workflow_version" + 1',
          lastWorkflowMutationId: body.mutationId,
          ...(statusChanged ? { lastMessageAt: now, closedAt: null } : {}),
          ...(conversation.status === 'ai' && nextStatus === 'human'
            ? { handoffReason: 'agent_takeover' }
            : {}),
        },
        manager,
      );

      if (statusChanged && body.assignedUserId !== null) {
        const content =
          body.assignedUserId === actorUserId
            ? `${actorName} joined the conversation.`
            : `${actorName} assigned the conversation to ${targetName ?? 'an agent'}.`;
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
      }

      await notifyWorkspace(manager, workspaceId, {
        type: 'conversation.updated',
        conversationId,
        botId: conversation.botId,
        status: updated.status,
      });
      if (this.outbox !== undefined) {
        await this.outbox.record(
          workspaceId,
          {
            type: 'conversation.updated',
            aggregateId: conversationId,
            idempotencyKey: `conversation:${conversationId}:assignment:${body.mutationId}`,
            data: {
              conversationId,
              botId: conversation.botId,
              status: updated.status,
              assignedUserId: updated.assignedUserId,
            },
          },
          manager,
        );
      }
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'conversation.assignment_changed',
          targetType: 'conversation',
          targetId: conversationId,
          metadata: {
            previousAssigneeId: conversation.assignedUserId,
            nextAssigneeId: updated.assignedUserId,
            reason:
              statusChanged && conversation.status === 'ai'
                ? 'agent_takeover'
                : body.assignedUserId === null
                  ? 'unassigned'
                  : 'assigned',
          },
        },
        manager,
      );

      return {
        assignedUserId: updated.assignedUserId,
        status: updated.status,
        workflowVersion: updated.workflowVersion,
        changed: true,
      };
    });

    if (result.changed && result.assignedUserId !== null) this.activeStreams.abort(conversationId);
    const assigneeName =
      result.assignedUserId === null
        ? null
        : result.assignedUserId === body.assignedUserId
          ? (names.get(result.assignedUserId) ?? 'Deleted user')
          : ((await this.inbox.authorsByIds([result.assignedUserId])).get(result.assignedUserId) ??
            'Deleted user');
    return {
      assignedTo:
        result.assignedUserId === null
          ? null
          : { id: result.assignedUserId, name: assigneeName ?? 'Deleted user' },
      status: result.status,
      workflowVersion: result.workflowVersion,
    };
  }

  async setPriority(
    workspaceId: WorkspaceId,
    conversationId: string,
    actorUserId: UserId,
    body: ConversationPriorityRequest,
  ): Promise<ConversationPriorityResponse> {
    return this.ds.transaction(async (manager) => {
      const conversation = await this.lock(workspaceId, conversationId, manager);
      if (conversation.lastWorkflowMutationId === body.mutationId) {
        return { priority: conversation.priority, workflowVersion: conversation.workflowVersion };
      }
      if (conversation.workflowVersion !== body.expectedWorkflowVersion) {
        throw new AppError('stale_conversation');
      }
      if (conversation.priority === body.priority) {
        return { priority: conversation.priority, workflowVersion: conversation.workflowVersion };
      }
      const updated = await this.conversations.updateById(
        workspaceId,
        conversationId,
        {
          priority: body.priority,
          workflowVersion: () => '"workflow_version" + 1',
          lastWorkflowMutationId: body.mutationId,
        },
        manager,
      );
      await notifyWorkspace(manager, workspaceId, {
        type: 'conversation.updated',
        conversationId,
        botId: conversation.botId,
        status: updated.status,
      });
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'conversation.priority_changed',
          targetType: 'conversation',
          targetId: conversationId,
          metadata: { previousPriority: conversation.priority, nextPriority: updated.priority },
        },
        manager,
      );
      return { priority: updated.priority, workflowVersion: updated.workflowVersion };
    });
  }

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
      const configured = await manager.query<{ configured: boolean }[]>(
        `SELECT EXISTS (
           SELECT 1 FROM integrations
            WHERE workspace_id = $1 AND status = 'active' AND crm_context_fields IS NOT NULL
              AND provider IN ('hubspot', 'pipedrive', 'intercom')
         ) AS configured`,
        [workspaceId],
      );
      if (configured[0]?.configured === true) {
        await this.jobs.enqueue(
          CRM_CONTEXT_JOB,
          { workspaceId, conversationId },
          { manager, singletonKey: `crm-context:${conversationId}` },
        );
      }
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
        workflowVersion: () => '"workflow_version" + 1',
        lastWorkflowMutationId: newId(),
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

  private assertAssignmentAllowed(
    conversation: ConversationEntity,
    actorUserId: UserId,
    actorRole: Role,
    assignedUserId: string | null,
  ): void {
    if (actorRole === 'owner' || actorRole === 'admin') return;
    if (assignedUserId === actorUserId) {
      if (conversation.assignedUserId !== null && conversation.assignedUserId !== actorUserId) {
        throw new AppError('already_assigned');
      }
      return;
    }
    if (assignedUserId === null && conversation.assignedUserId === actorUserId) return;
    throw new AppError('forbidden');
  }

  private async displayName(userId: UserId): Promise<string> {
    const names = await this.inbox.authorsByIds([userId]);
    return names.get(userId) ?? 'An agent';
  }
}
