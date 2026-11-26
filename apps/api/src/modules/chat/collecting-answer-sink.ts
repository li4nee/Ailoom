// SPDX-License-Identifier: AGPL-3.0-only
import type { Citation, ErrorCode, NoAnswerBehavior, TraceDecision } from '@app/shared';

import type { AnswerSink } from './answer-sink';
import type { EscalationReason } from './domain/escalation';

export interface CollectedAnswer {
  content: string;
  citations: Citation[];
  escalated: { reason: EscalationReason; behavior: NoAnswerBehavior } | null;
  error: { code: ErrorCode; message: string } | null;
  trace: {
    traceId: string;
    decision: TraceDecision;
    topScore: number | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: string;
    latencyMs: number;
  } | null;
}

/** An in-memory sink for pipeline runs that must not create a user-visible stream. */
export class CollectingAnswerSink implements AnswerSink {
  private content = '';
  private citations: Citation[] = [];
  private escalationValue: CollectedAnswer['escalated'] = null;
  private errorValue: CollectedAnswer['error'] = null;
  private traceValue: CollectedAnswer['trace'] = null;

  accepted(): void {
    // The in-memory sink does not expose stream lifecycle events.
  }
  started(): void {
    // The in-memory sink does not expose stream lifecycle events.
  }
  toolProgress(): void {
    // The in-memory sink does not expose stream lifecycle events.
  }
  delta(text: string): void {
    this.content += text;
  }
  completed(event: { messageId: string; content: string; citations: Citation[] }): void {
    this.content = event.content;
    this.citations = event.citations;
  }
  escalated(event: {
    messageId: string;
    reason: EscalationReason;
    behavior: NoAnswerBehavior;
    content: string;
  }): void {
    this.content = event.content;
    this.escalationValue = { reason: event.reason, behavior: event.behavior };
  }
  handoffOffered(): void {
    this.escalationValue = { reason: 'handoff_intent', behavior: 'offer_handoff' };
  }
  error(event: { code: ErrorCode; message: string }): void {
    this.errorValue = event;
  }
  trace(event: NonNullable<CollectedAnswer['trace']>): void {
    this.traceValue = event;
  }

  result(): CollectedAnswer {
    return {
      content: this.content,
      citations: this.citations,
      escalated: this.escalationValue,
      error: this.errorValue,
      trace: this.traceValue,
    };
  }
}
