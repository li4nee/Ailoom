// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { ZodError } from 'zod';

import type {
  ConversationStatus,
  IdentifyContactResponse,
  SessionResponse,
  WidgetConfig,
  WidgetConversation,
} from '@app/shared';
import {
  appearanceSchema,
  contrastText,
  createConversationSchema,
  createSessionSchema,
  feedbackSchema,
  handoffSchema,
  identifyContactSchema,
} from '@app/shared';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { asBotId, asContactId } from '../../db/ids';
import { isUniqueViolation } from '../../db/postgres-errors';
import { CONTACT_UPDATED } from '../../events';
import type { BotEntity } from '../bots';
import {
  CHAT_HANDOFF_REQUESTED,
  DEFAULT_HANDOFF_MESSAGE,
  type ChatHandoffRequestedEvent,
} from '../chat';
import {
  ContactsRepository,
  ConversationsRepository,
  type ContactEntity,
  type ConversationEntity,
  MessagesRepository,
} from '../conversations';
import { OutboxService } from '../integrations';
import { notifyWorkspace } from '../realtime';
import { UsageRepository, utcDay } from '../usage';
import { ChallengeService } from './challenge.service';
import { VisitorTokenService, type VisitorClaims } from './visitor-token.service';
import type { CurrentVisitorData, PublicVisitorData } from './widget-rate-limits';
import { toWidgetConversation } from './widget.mapper';

/** How many messages a resumed conversation returns (spec §17.9). */
const CURRENT_MESSAGES = 50;
const CONTACT_ATTRIBUTES_MAX_BYTES = 16_384;

function validationError(error: ZodError): AppError {
  return new AppError('validation_failed', {
    details: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

/**
 * The widget API's work behind its controllers (spec §10.4, §17.9): session create/resume,
 * the config the widget renders with, and the visitor's current/new conversation. Every
 * method takes the `{ claims, bot }` the visitor guard resolved, so no caller ever supplies
 * its own tenant or contact identity.
 */
@Injectable()
export class WidgetService {
  constructor(
    private readonly clock: Clock,
    private readonly tokens: VisitorTokenService,
    private readonly challenges: ChallengeService,
    private readonly contacts: ContactsRepository,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly usage: UsageRepository,
    private readonly events: EventEmitter2,
    private readonly ds: DataSource,
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  /**
   * Creates or resumes the visitor's contact and returns a fresh 30-day token (spec §10.4).
   * A token from another bot or workspace is ignored rather than rejected: the visitor gets a
   * new contact instead of a dead end.
   */
  async createSession(visitor: PublicVisitorData, body: unknown): Promise<SessionResponse> {
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);

    const bot = visitor.bot;
    if (bot.requireChallenge) {
      if (parsed.data.challenge === undefined) throw new AppError('challenge_required');
      if (!(await this.challenges.verify(parsed.data.challenge))) {
        throw new AppError('challenge_invalid');
      }
    }

    const contact = await this.resumeOrCreate(bot, parsed.data.token);
    const token = await this.tokens.issue({
      contactId: asContactId(contact.id),
      botId: asBotId(bot.id),
      workspaceId: bot.workspaceId,
    });
    return { token, contactId: contact.id };
  }

  /**
   * Attaches host-application identity to the current visitor only. An external id already
   * claimed by another contact is a conflict, never an implicit merge (M8 Task 8.1).
   */
  async identify(visitor: CurrentVisitorData, body: unknown): Promise<IdentifyContactResponse> {
    const parsed = identifyContactSchema.safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);

    const { claims } = visitor;
    let updated: ContactEntity;
    try {
      updated = await this.ds.transaction(async (manager) => {
        const contact = await this.contacts.getById(
          claims.workspaceId,
          claims.contactId,
          'not_found',
          manager,
        );
        if (contact.externalId !== null && contact.externalId !== parsed.data.externalId) {
          throw new AppError('conflict', {
            details: [
              {
                path: 'externalId',
                message: 'This visitor is already identified and cannot change external identity.',
              },
            ],
          });
        }

        const claimed = await this.contacts.findByExternalId(
          claims.workspaceId,
          parsed.data.externalId,
          manager,
        );
        if (claimed !== null && claimed.id !== contact.id) {
          throw new AppError('conflict', {
            details: [
              { path: 'externalId', message: 'This external identity belongs to another contact.' },
            ],
          });
        }

        const attributes =
          parsed.data.attributes === undefined
            ? contact.attributes
            : { ...(contact.attributes ?? {}), ...parsed.data.attributes };
        if (
          attributes !== null &&
          JSON.stringify(attributes).length > CONTACT_ATTRIBUTES_MAX_BYTES
        ) {
          throw new AppError('validation_failed', {
            details: [
              {
                path: 'attributes',
                message: `Attributes must be no larger than ${String(CONTACT_ATTRIBUTES_MAX_BYTES)} bytes.`,
              },
            ],
          });
        }

        const patch: QueryDeepPartialEntity<ContactEntity> = {
          externalId: parsed.data.externalId,
          ...(parsed.data.email === undefined ? {} : { email: parsed.data.email }),
          ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
          attributes: attributes as unknown as NonNullable<
            QueryDeepPartialEntity<ContactEntity>['attributes']
          >,
          lastSeenAt: this.clock.now(),
        };
        const result = await this.contacts.updateById(
          claims.workspaceId,
          contact.id,
          patch,
          manager,
        );
        if (this.outbox !== undefined) {
          await this.outbox.record(
            claims.workspaceId,
            {
              type: 'contact.updated',
              aggregateId: result.id,
              idempotencyKey: `contact:${result.id}:identified:${parsed.data.externalId}`,
              data: {
                contactId: result.id,
                externalId: result.externalId,
                email: result.email,
                name: result.name,
                attributes: result.attributes,
              },
            },
            manager,
          );
        }
        return result;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('conflict', {
          details: [
            { path: 'externalId', message: 'This external identity belongs to another contact.' },
          ],
          cause: error,
        });
      }
      throw error;
    }
    this.events.emit(CONTACT_UPDATED, { workspaceId: claims.workspaceId, contactId: updated.id });
    return {
      contactId: updated.id,
      externalId: updated.externalId ?? parsed.data.externalId,
      email: updated.email,
      name: updated.name,
      attributes: updated.attributes,
    };
  }

  /** Appearance and feature flags; never keys, credentials, prompts or threshold internals. */
  config(bot: BotEntity): WidgetConfig {
    const appearance = appearanceSchema.parse(bot.appearance);
    return {
      displayName: appearance.displayName,
      themeColor: appearance.themeColor,
      textColor: contrastText(appearance.themeColor),
      avatarUrl: appearance.avatarUrl,
      position: appearance.position,
      welcomeMessage: appearance.welcomeMessage,
      privacyUrl: appearance.privacyUrl,
      handoffEnabled: bot.handoffEnabled,
      // Phase 1 has no per-bot feedback switch; thumbs are always offered on AI answers.
      feedbackEnabled: true,
      requireChallenge: bot.requireChallenge,
    };
  }

  /** The returning visitor's latest non-closed conversation, with its last 50 messages. */
  async current(visitor: CurrentVisitorData): Promise<WidgetConversation | null> {
    const claims = visitor.claims;
    const conversation = await this.conversations.latestOpenForContact(
      claims.workspaceId,
      claims.botId,
      claims.contactId,
    );
    if (conversation === null) return null;

    const messages = await this.messages.listRecentForConversation(
      claims.workspaceId,
      conversation.id,
      CURRENT_MESSAGES,
    );
    return toWidgetConversation(conversation, messages);
  }

  /** Starts a conversation with the page metadata the widget collected. */
  async createConversation(
    visitor: CurrentVisitorData,
    body: unknown,
    userAgent: string | null,
  ): Promise<WidgetConversation> {
    const claims = visitor.claims;
    const parsed = createConversationSchema.safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);

    const now = this.clock.now();
    const metadata: Record<string, unknown> = {
      ...(parsed.data.metadata ?? {}),
      ...(userAgent === null ? {} : { userAgent }),
    };

    const conversation = await this.ds.transaction(async (manager) => {
      const created = await this.conversations.insert(
        claims.workspaceId,
        {
          botId: claims.botId,
          contactId: claims.contactId,
          channel: 'web',
          status: 'ai',
          lastMessageAt: now,
          metadata,
        },
        manager,
      );

      await this.usage.increment(
        manager,
        { workspaceId: claims.workspaceId, botId: claims.botId, day: utcDay(now) },
        { conversations: 1 },
      );
      // Delivered only if this transaction commits (spec §18.3).
      await notifyWorkspace(manager, claims.workspaceId, {
        type: 'conversation.created',
        conversationId: created.id,
        botId: claims.botId,
        status: created.status,
      });
      if (this.outbox !== undefined) {
        await this.outbox.record(
          claims.workspaceId,
          {
            type: 'conversation.created',
            aggregateId: created.id,
            idempotencyKey: `conversation:${created.id}`,
            data: {
              conversationId: created.id,
              botId: claims.botId,
              contactId: claims.contactId,
              status: created.status,
            },
          },
          manager,
        );
      }
      return created;
    });

    return toWidgetConversation(conversation, []);
  }

  /**
   * A valid token for this bot and workspace resumes its contact; anything else — an expired,
   * forged or foreign token, or a deleted contact — starts a new contact.
   */
  private async resumeOrCreate(bot: BotEntity, token: string | undefined): Promise<ContactEntity> {
    const now = this.clock.now();
    if (token !== undefined) {
      const resumed = await this.resume(bot, token);
      if (resumed !== null) {
        return this.contacts.updateById(bot.workspaceId, resumed.id, { lastSeenAt: now });
      }
    }
    const create = async (manager?: EntityManager) => {
      const contact = await this.contacts.insert(
        bot.workspaceId,
        {
          firstSeenAt: now,
          lastSeenAt: now,
          attributes: null,
          externalId: null,
          email: null,
          name: null,
        },
        manager,
      );
      if (manager !== undefined && this.outbox !== undefined) {
        await this.outbox.record(
          bot.workspaceId,
          {
            type: 'contact.created',
            aggregateId: contact.id,
            idempotencyKey: `contact:${contact.id}`,
            data: {
              contactId: contact.id,
              externalId: null,
              email: null,
              name: null,
              attributes: null,
            },
          },
          manager,
        );
      }
      return contact;
    };
    return this.outbox === undefined ? create() : this.ds.transaction((manager) => create(manager));
  }

  /**
   * The conversation, only if it belongs to this visitor's contact and bot. Every route that
   * takes a conversation id goes through here, so an id from anywhere else is a 404.
   */
  async ownConversation(
    visitor: CurrentVisitorData,
    conversationId: string,
  ): Promise<ConversationEntity> {
    const claims = visitor.claims;
    const conversation = await this.conversations.getById(claims.workspaceId, conversationId);
    if (conversation.contactId !== claims.contactId || conversation.botId !== claims.botId) {
      throw new AppError('not_found');
    }
    return conversation;
  }

  /**
   * The visitor asks for a person (spec §17.9): optionally leaves an email, the conversation
   * moves to `needs_human`, one system message records the request, and the handoff event is
   * emitted only after that transaction commits. Repeated requests are idempotent.
   */
  async handoff(
    visitor: CurrentVisitorData,
    conversationId: string,
    body: unknown,
  ): Promise<{ status: ConversationStatus; handoffMessage: string }> {
    const claims = visitor.claims;
    const parsed = handoffSchema.safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);
    if (!visitor.bot.handoffEnabled) throw new AppError('handoff_disabled');

    const conversation = await this.ownConversation(visitor, conversationId);
    const now = this.clock.now();
    const firstRequest = conversation.handoffRequestedAt === null;
    let status = conversation.status;

    await this.ds.transaction(async (manager) => {
      if (parsed.data.email !== undefined) {
        await this.contacts.updateById(
          claims.workspaceId,
          claims.contactId,
          { email: parsed.data.email, lastSeenAt: now },
          manager,
        );
      }

      // An agent already in the conversation keeps it: the visitor's request is for a person,
      // and a person is already there. A closed conversation is not reopened by handoff.
      if (conversation.status === 'ai' || conversation.status === 'needs_human') {
        const updated = await this.conversations.updateById(
          claims.workspaceId,
          conversation.id,
          {
            status: 'needs_human',
            handoffReason: conversation.handoffReason ?? 'visitor_request',
            handoffRequestedAt: conversation.handoffRequestedAt ?? now,
            lastMessageAt: firstRequest ? now : conversation.lastMessageAt,
          },
          manager,
        );
        status = updated.status;

        if (firstRequest) {
          const message = await this.messages.insert(
            claims.workspaceId,
            {
              conversationId: conversation.id,
              role: 'system',
              content: 'Visitor asked to talk to a person.',
              status: 'complete',
              createdAt: now,
            },
            manager,
          );
          await notifyWorkspace(manager, claims.workspaceId, {
            type: 'message.created',
            conversationId: conversation.id,
            messageId: message.id,
            role: 'system',
          });
        }
        await notifyWorkspace(manager, claims.workspaceId, {
          type: 'conversation.updated',
          conversationId: conversation.id,
          botId: conversation.botId,
          status: updated.status,
        });
        if (this.outbox !== undefined && firstRequest) {
          await this.outbox.record(
            claims.workspaceId,
            {
              type: 'handoff.requested',
              aggregateId: conversation.id,
              idempotencyKey: `handoff:${conversation.id}`,
              data: {
                conversationId: conversation.id,
                reason: updated.handoffReason ?? 'visitor_request',
              },
            },
            manager,
          );
        }
      }
    });

    if (firstRequest && status === 'needs_human') {
      const event: ChatHandoffRequestedEvent = {
        workspaceId: claims.workspaceId,
        botId: claims.botId,
        conversationId: conversation.id,
      };
      this.events.emit(CHAT_HANDOFF_REQUESTED, event);
    }

    return {
      status,
      handoffMessage: visitor.bot.handoffMessage ?? DEFAULT_HANDOFF_MESSAGE,
    };
  }

  /**
   * Thumbs on an AI answer of this visitor's conversations only (spec §17.9). Visitor, system
   * and agent messages, and messages from other contacts, are all a 404.
   */
  async feedback(visitor: CurrentVisitorData, messageId: string, body: unknown): Promise<void> {
    const claims = visitor.claims;
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);

    const message = await this.messages.findById(claims.workspaceId, messageId);
    if (message?.role !== 'ai') throw new AppError('not_found');
    const conversation = await this.conversations.findById(
      claims.workspaceId,
      message.conversationId,
    );
    if (conversation === null) throw new AppError('not_found');
    if (conversation.contactId !== claims.contactId || conversation.botId !== claims.botId) {
      throw new AppError('not_found');
    }

    await this.ds.transaction(async (manager) => {
      await this.messages.updateById(
        claims.workspaceId,
        message.id,
        {
          feedback: parsed.data.rating,
          feedbackAt: this.clock.now(),
        },
        manager,
      );
      if (this.outbox !== undefined) {
        await this.outbox.record(
          claims.workspaceId,
          {
            type: 'feedback.created',
            aggregateId: message.id,
            idempotencyKey: `feedback:${message.id}`,
            data: {
              messageId: message.id,
              conversationId: message.conversationId,
              rating: parsed.data.rating,
            },
          },
          manager,
        );
      }
    });
  }

  private async resume(bot: BotEntity, token: string): Promise<ContactEntity | null> {
    let claims: VisitorClaims;
    try {
      claims = await this.tokens.verify(token);
    } catch {
      return null;
    }
    if (claims.botId !== bot.id || claims.workspaceId !== bot.workspaceId) return null;
    return this.contacts.findById(bot.workspaceId, claims.contactId);
  }
}
