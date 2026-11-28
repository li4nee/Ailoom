// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { NotificationDto, NotificationPayload, NotificationQuery, Role } from '@app/shared';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import type { UserId, WorkspaceId } from '../../db/ids';
import { EmailService } from '../email';
import { notifyWorkspace } from '../realtime';
import { MembershipsRepository } from '../workspaces';
import { NotificationPreferencesService } from './notification-preferences.service';
import type { NotificationEvent } from './notification.events';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly preferences: NotificationPreferencesService,
    private readonly clock: Clock,
    private readonly email: EmailService,
  ) {}

  async notify(manager: EntityManager, event: NotificationEvent): Promise<void> {
    if (event.type === 'visitor_replied') {
      event = {
        ...event,
        hasInternalNotes:
          event.hasInternalNotes ||
          (await this.notifications.hasInternalNotes(
            event.workspaceId,
            event.conversationId,
            manager,
          )),
      };
    }
    const roles: readonly Role[] =
      event.type === 'handoff_requested' ||
      event.type === 'conversation_assigned' ||
      event.type === 'visitor_replied' ||
      event.type === 'suggestion_reviewed'
        ? []
        : ['owner', 'admin'];
    const userIds =
      event.type === 'conversation_assigned' || event.type === 'visitor_replied'
        ? [event.assigneeUserId]
        : event.type === 'suggestion_reviewed'
          ? event.creatorUserId === null
            ? []
            : [event.creatorUserId]
          : undefined;
    const recipients = await this.notifications.membershipRecipients(
      event.workspaceId,
      roles,
      manager,
      userIds,
    );
    const memberEmails = new Set<string>();
    const now = this.clock.now();

    for (const recipient of recipients) {
      if (recipient.userId === event.actorUserId) continue;
      const preference = this.preferences.forType(
        recipient.role,
        recipient.preferences,
        event.type,
      );
      const payload = this.payload(event);
      if (preference.inApp) {
        const dedupeKey =
          event.type === 'visitor_replied'
            ? `conversation:${event.conversationId}:visitor_replied`
            : null;
        await this.notifications.create(
          event.workspaceId,
          recipient.userId,
          event.type,
          payload,
          manager,
          dedupeKey,
          now,
        );
        await notifyWorkspace(manager, event.workspaceId, {
          type: 'notification.created',
          userId: recipient.userId,
        });
      }
      if (preference.email) memberEmails.add(recipient.email);
    }

    if (!this.email.isEnabled()) return;
    const legacyEmails =
      event.type === 'handoff_requested' || event.type === 'spend_alert'
        ? event.legacyRecipients
        : [];
    const toAddresses = new Map<string, string>();
    for (const address of [...memberEmails, ...legacyEmails]) {
      const key = address.trim().toLocaleLowerCase('en-US');
      if (key !== '' && !toAddresses.has(key)) toAddresses.set(key, address.trim());
    }
    const email = this.emailMessage(event);
    if (email === null) return;
    for (const to of toAddresses.values()) await this.queueEmail(email, to, manager);
  }

  async list(
    workspaceId: WorkspaceId,
    userId: UserId,
    query: NotificationQuery,
  ): Promise<{ data: NotificationDto[]; nextCursor: string | null; unreadCount: number }> {
    await this.assertMember(workspaceId, userId);
    return this.notifications.listForUser(workspaceId, userId, query);
  }

  async markRead(
    workspaceId: WorkspaceId,
    userId: UserId,
    notificationId: string,
  ): Promise<NotificationDto> {
    await this.assertMember(workspaceId, userId);
    return this.notifications.markRead(workspaceId, userId, notificationId, this.clock.now());
  }

  async markAllRead(workspaceId: WorkspaceId, userId: UserId): Promise<{ updated: number }> {
    await this.assertMember(workspaceId, userId);
    return { updated: await this.notifications.markAllRead(workspaceId, userId, this.clock.now()) };
  }

  getPreferences(workspaceId: WorkspaceId, userId: UserId) {
    return this.preferences.get(workspaceId, userId);
  }

  updatePreferences(
    workspaceId: WorkspaceId,
    userId: UserId,
    input: Parameters<NotificationPreferencesService['update']>[2],
  ) {
    return this.preferences.update(workspaceId, userId, input);
  }

  async retain(): Promise<number> {
    return this.notifications.deleteExpired(this.clock.now());
  }

  private payload(event: NotificationEvent): NotificationPayload {
    switch (event.type) {
      case 'handoff_requested':
        return {
          conversationId: event.conversationId,
          botId: event.botId,
          title: 'A conversation needs a person',
          body: `${event.botName} has a conversation waiting for an agent.`,
        };
      case 'conversation_assigned':
        return {
          conversationId: event.conversationId,
          botId: event.botId,
          title: 'A conversation was assigned to you',
          body: `${event.actorName} assigned a conversation to you.`,
        };
      case 'visitor_replied':
        return {
          conversationId: event.conversationId,
          botId: event.botId,
          title: 'A visitor replied',
          body: event.hasInternalNotes
            ? 'A visitor replied in a conversation assigned to you.'
            : event.preview.slice(0, 140),
        };
      case 'spend_alert':
        return {
          botId: event.botId,
          title: `${event.botName} reached ${String(event.threshold)}% of its spend cap`,
          body: `Month-to-date spend is $${event.mtdUsd} of a $${event.capUsd} cap.`,
        };
      case 'suggestion_created':
        return {
          suggestionId: event.suggestionId,
          botId: event.botId,
          title: 'A knowledge correction needs review',
          body: 'An agent submitted a suggested answer for approval.',
        };
      case 'suggestion_reviewed':
        return {
          suggestionId: event.suggestionId,
          botId: event.botId,
          title: `Your correction was ${event.status}`,
          body: `An administrator ${event.status} your suggested answer.`,
        };
      case 'sla_breached':
        return {
          conversationId: event.conversationId,
          title:
            event.breach === 'first_response'
              ? 'First response SLA breached'
              : 'Resolution SLA breached',
          body: 'A conversation has passed its configured service target.',
        };
    }
  }

  private emailMessage(event: NotificationEvent):
    | {
        template: 'handoff_requested';
        data: {
          workspaceId: WorkspaceId;
          conversationId: string;
          botName: string;
          reason: string | null;
          contactEmail: string | null;
          lastMessage: string | null;
        };
      }
    | {
        template: 'conversation_assigned';
        data: { workspaceId: WorkspaceId; conversationId: string; actorName: string };
      }
    | {
        template: 'visitor_replied';
        data: { workspaceId: WorkspaceId; conversationId: string; preview: string | null };
      }
    | {
        template: 'spend_alert';
        data: {
          botName: string;
          month: string;
          threshold: 80 | 100;
          mtdUsd: string;
          capUsd: string;
          topContacts: Extract<NotificationEvent, { type: 'spend_alert' }>['topContacts'];
        };
      }
    | {
        template: 'suggestion';
        data: {
          workspaceId: WorkspaceId;
          suggestionId: string;
          status: 'created' | 'approved' | 'rejected';
        };
      }
    | null {
    switch (event.type) {
      case 'handoff_requested':
        return {
          template: 'handoff_requested',
          data: {
            workspaceId: event.workspaceId,
            conversationId: event.conversationId,
            botName: event.botName,
            reason: event.reason,
            contactEmail: event.contactEmail,
            lastMessage: event.lastMessage,
          },
        };
      case 'conversation_assigned':
        return {
          template: 'conversation_assigned',
          data: {
            workspaceId: event.workspaceId,
            conversationId: event.conversationId,
            actorName: event.actorName,
          },
        };
      case 'visitor_replied':
        return {
          template: 'visitor_replied',
          data: {
            workspaceId: event.workspaceId,
            conversationId: event.conversationId,
            preview: event.hasInternalNotes ? null : event.preview.slice(0, 140),
          },
        };
      case 'spend_alert':
        return {
          template: 'spend_alert',
          data: {
            botName: event.botName,
            month: event.month,
            threshold: event.threshold,
            mtdUsd: event.mtdUsd,
            capUsd: event.capUsd,
            topContacts: event.topContacts,
          },
        };
      case 'suggestion_created':
        return {
          template: 'suggestion',
          data: {
            workspaceId: event.workspaceId,
            suggestionId: event.suggestionId,
            status: 'created',
          },
        };
      case 'suggestion_reviewed':
        return {
          template: 'suggestion',
          data: {
            workspaceId: event.workspaceId,
            suggestionId: event.suggestionId,
            status: event.status,
          },
        };
      case 'sla_breached':
        return null;
    }
  }

  private queueEmail(
    email: NonNullable<ReturnType<NotificationsService['emailMessage']>>,
    to: string,
    manager: EntityManager,
  ): Promise<void> {
    switch (email.template) {
      case 'handoff_requested':
        return this.email.send(email.template, to, email.data, { manager });
      case 'conversation_assigned':
        return this.email.send(email.template, to, email.data, { manager });
      case 'visitor_replied':
        return this.email.send(email.template, to, email.data, { manager });
      case 'spend_alert':
        return this.email.send(email.template, to, email.data, { manager });
      case 'suggestion':
        return this.email.send(email.template, to, email.data, { manager });
    }
  }

  private async assertMember(workspaceId: WorkspaceId, userId: UserId): Promise<void> {
    if (!(await this.memberships.notificationPreferences(workspaceId, userId))) {
      throw new AppError('not_found');
    }
  }
}
