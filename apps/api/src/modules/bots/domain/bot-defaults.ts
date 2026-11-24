// SPDX-License-Identifier: AGPL-3.0-only
import type { Appearance, NoAnswerBehavior } from '@app/shared';

export interface BotDefaults {
  allowedOrigins: string[];
  noAnswerBehavior: NoAnswerBehavior;
  handoffEnabled: boolean;
  csatEnabled: boolean;
  /** Null means "use the catalog default for the model" (spec §13.3). */
  retrievalThreshold: number | null;
  temperature: number;
  maxOutputTokens: number;
  monthlySpendCapUsd: string | null;
  requireChallenge: boolean;
  allowedLinkDomains: string[];
  /** Null means "use the built-in handoff phrases" (spec §14.1). */
  handoffPhrases: string[] | null;
  fallbackMessage: string;
  handoffMessage: string;
  appearance: Appearance;
}

/**
 * What every new bot starts with (spec §9.2). Stored on the bot rather than read at answer time:
 * an operator who edits a message expects it to stay edited after a deploy.
 */
export const BOT_DEFAULTS: BotDefaults = {
  allowedOrigins: [],
  noAnswerBehavior: 'offer_handoff',
  handoffEnabled: true,
  csatEnabled: true,
  retrievalThreshold: null,
  temperature: 0.2,
  maxOutputTokens: 600,
  monthlySpendCapUsd: null,
  requireChallenge: false,
  allowedLinkDomains: [],
  handoffPhrases: null,
  fallbackMessage: "I couldn't find that in our help content. Would you like to talk to a person?",
  handoffMessage: 'Thanks — our team will reply here, and by email if you leave one.',
  appearance: {
    displayName: 'Support',
    themeColor: '#c7f36b',
    position: 'right',
    welcomeMessage: 'Hi! How can I help?',
    avatarUrl: null,
    privacyUrl: null,
  },
};
