// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ZodError } from 'zod';

import type { SessionResponse, WidgetConfig, WidgetConversation } from '@app/shared';
import {
  appearanceSchema,
  contrastText,
  createConversationSchema,
  createSessionSchema,
} from '@app/shared';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { asBotId, asContactId } from '../../db/ids';
import type { BotEntity } from '../bots';
import {
  ContactsRepository,
  ConversationsRepository,
  type ContactEntity,
  MessagesRepository,
} from '../conversations';
import { notifyWorkspace } from '../realtime';
import { UsageRepository } from '../usage';
import { utcDay } from '../usage/utc';
import { ChallengeService } from './challenge.service';
import { VisitorTokenService, type VisitorClaims } from './visitor-token.service';
import type { CurrentVisitorData } from './widget-rate-limits';
import { toWidgetConversation } from './widget.mapper';

/** How many messages a resumed conversation returns (spec §17.9). */
const CURRENT_MESSAGES = 50;

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
    private readonly ds: DataSource,
  ) {}

  /**
   * Creates or resumes the visitor's contact and returns a fresh 30-day token (spec §10.4).
   * A token from another bot or workspace is ignored rather than rejected: the visitor gets a
   * new contact instead of a dead end.
   */
  async createSession(visitor: CurrentVisitorData, body: unknown): Promise<SessionResponse> {
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
    const claims = this.claims(visitor);
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
    const claims = this.claims(visitor);
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
      return created;
    });

    return toWidgetConversation(conversation, []);
  }

  private claims(visitor: CurrentVisitorData): VisitorClaims {
    if (visitor.claims === null) throw new AppError('unauthorized');
    return visitor.claims;
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
    return this.contacts.insert(bot.workspaceId, {
      firstSeenAt: now,
      lastSeenAt: now,
      attributes: null,
      externalId: null,
      email: null,
      name: null,
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
