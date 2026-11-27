// SPDX-License-Identifier: AGPL-3.0-only
import type { NoAnswerBehavior } from '@app/shared';

import type { BotEntity } from '../../bots';

/** Why an answer attempt ended without an answer (spec §14.1). */
export type EscalationReason =
  | 'no_knowledge'
  | 'top_score_below_threshold'
  | 'handoff_intent'
  | 'spend_cap_reached'
  | 'provider_error'
  | 'visitor_request'
  | 'unsupported_answer';

export type RetrievalDecision =
  { kind: 'answer' } | { kind: 'escalate'; reason: 'no_knowledge' | 'top_score_below_threshold' };

/** Used only when a bot row has no operator-defined message; the defaults set it on create. */
export const DEFAULT_FALLBACK_MESSAGE =
  "I couldn't find that in our help content. Would you like to talk to a person?";
export const DEFAULT_HANDOFF_MESSAGE =
  'Thanks — our team will reply here, and by email if you leave one.';

/**
 * Spec §14.1: no ready chunk at all → no knowledge; a best score below the threshold → weak
 * retrieval. A score at the threshold counts as relevant (`>=`), matching `selectUsedChunks`.
 */
export function decideRetrieval(input: {
  readyChunkCount: number;
  topScore: number | null;
  threshold: number;
}): RetrievalDecision {
  if (input.readyChunkCount === 0) return { kind: 'escalate', reason: 'no_knowledge' };
  if (input.topScore === null || input.topScore < input.threshold) {
    return { kind: 'escalate', reason: 'top_score_below_threshold' };
  }
  return { kind: 'answer' };
}

export interface EscalationOutcome {
  behavior: NoAnswerBehavior;
  content: string;
  setsNeedsHuman: boolean;
}

/** What the visitor sees and whether the conversation needs a human (spec §14.2). */
export function escalationOutcome(
  bot: Pick<
    BotEntity,
    'noAnswerBehavior' | 'handoffEnabled' | 'fallbackMessage' | 'handoffMessage'
  >,
  reason: EscalationReason,
): EscalationOutcome {
  // With handoff disabled the bot can never offer or perform one, whatever the reason.
  const behavior = bot.handoffEnabled
    ? behaviorFor(bot.noAnswerBehavior, reason)
    : 'fallback_message';
  const content =
    behavior === 'auto_handoff'
      ? (bot.handoffMessage ?? DEFAULT_HANDOFF_MESSAGE)
      : (bot.fallbackMessage ?? DEFAULT_FALLBACK_MESSAGE);

  return { behavior, content, setsNeedsHuman: behavior === 'auto_handoff' };
}

function behaviorFor(configured: NoAnswerBehavior, reason: EscalationReason): NoAnswerBehavior {
  switch (reason) {
    case 'no_knowledge':
    case 'top_score_below_threshold':
    case 'unsupported_answer':
      return configured;
    // Spec §14.2: provider errors and the spend cap always offer a handoff, regardless of the
    // bot's no-answer behavior; a text match only offers one (the button is the real path).
    case 'provider_error':
    case 'spend_cap_reached':
    case 'handoff_intent':
      return 'offer_handoff';
    case 'visitor_request':
      return 'auto_handoff';
  }
}
