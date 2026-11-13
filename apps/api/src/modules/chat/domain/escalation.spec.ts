// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { BotEntity } from '../../bots';
import { decideRetrieval, escalationOutcome, type EscalationReason } from './escalation';

const FALLBACK = 'No answer from our help content. Want a person?';
const HANDOFF_MSG = 'Our team will reply here shortly.';

const bot = {
  noAnswerBehavior: 'offer_handoff',
  handoffEnabled: true,
  fallbackMessage: FALLBACK,
  handoffMessage: HANDOFF_MSG,
} as Pick<BotEntity, 'noAnswerBehavior' | 'handoffEnabled' | 'fallbackMessage' | 'handoffMessage'>;

describe('decideRetrieval', () => {
  it('no ready chunks → no_knowledge', () => {
    expect(decideRetrieval({ readyChunkCount: 0, topScore: null, threshold: 0.35 })).toEqual({
      kind: 'escalate',
      reason: 'no_knowledge',
    });
  });

  it('below threshold → escalate', () => {
    expect(decideRetrieval({ readyChunkCount: 5, topScore: 0.34, threshold: 0.35 })).toEqual({
      kind: 'escalate',
      reason: 'top_score_below_threshold',
    });
  });

  it('at threshold → answer', () => {
    expect(decideRetrieval({ readyChunkCount: 5, topScore: 0.35, threshold: 0.35 })).toEqual({
      kind: 'answer',
    });
  });
});

describe('escalationOutcome', () => {
  it.each<[BotEntity['noAnswerBehavior'], EscalationReason, object]>([
    [
      'fallback_message',
      'top_score_below_threshold',
      { behavior: 'fallback_message', content: FALLBACK, setsNeedsHuman: false },
    ],
    [
      'offer_handoff',
      'no_knowledge',
      { behavior: 'offer_handoff', content: FALLBACK, setsNeedsHuman: false },
    ],
    [
      'auto_handoff',
      'no_knowledge',
      { behavior: 'auto_handoff', content: HANDOFF_MSG, setsNeedsHuman: true },
    ],
    [
      'fallback_message',
      'provider_error',
      { behavior: 'offer_handoff', content: FALLBACK, setsNeedsHuman: false },
    ],
    [
      'auto_handoff',
      'spend_cap_reached',
      { behavior: 'offer_handoff', content: FALLBACK, setsNeedsHuman: false },
    ],
  ])('bot %s + %s', (noAnswerBehavior, reason, expected) => {
    expect(escalationOutcome({ ...bot, noAnswerBehavior }, reason)).toEqual(expected);
  });

  it('handoff disabled → always fallback_message', () => {
    expect(
      escalationOutcome(
        { ...bot, handoffEnabled: false, noAnswerBehavior: 'auto_handoff' },
        'no_knowledge',
      ).behavior,
    ).toBe('fallback_message');
    expect(escalationOutcome({ ...bot, handoffEnabled: false }, 'visitor_request')).toEqual({
      behavior: 'fallback_message',
      content: FALLBACK,
      setsNeedsHuman: false,
    });
  });
});
