// SPDX-License-Identifier: AGPL-3.0-only
import type { Citation, ErrorCode, NoAnswerBehavior, TraceDecision } from '@app/shared';

import type { SseStream } from '../realtime';
import type { AnswerSink } from './answer-sink';
import type { EscalationReason } from './domain/escalation';

export interface SseAnswerSinkOptions {
  /** Playground runs end with a `trace` event (spec §18.2); widget runs do not. */
  includeTrace: boolean;
}

/**
 * Maps the orchestrator's sink calls to the visitor message stream events of spec §18.2. The
 * same class serves the admin playground (Task 4.10) and the widget (Task 5.5).
 */
export class SseAnswerSink implements AnswerSink {
  constructor(
    private readonly stream: SseStream,
    private readonly options: SseAnswerSinkOptions,
  ) {}

  accepted(event: { messageId: string; createdAt: string }): void {
    this.stream.send('message.accepted', event);
  }

  started(event: { messageId: string }): void {
    this.stream.send('answer.started', event);
  }

  delta(text: string): void {
    this.stream.send('answer.delta', { text });
  }

  completed(event: { messageId: string; content: string; citations: Citation[] }): void {
    this.stream.send('answer.completed', event);
  }

  escalated(event: {
    messageId: string;
    reason: EscalationReason;
    behavior: NoAnswerBehavior;
    content: string;
  }): void {
    this.stream.send('escalated', event);
  }

  handoffOffered(event: { messageId: string; reason: 'handoff_intent' }): void {
    this.stream.send('handoff.offered', event);
  }

  error(event: { code: ErrorCode; message: string }): void {
    this.stream.send('error', event);
  }

  trace(event: {
    traceId: string;
    decision: TraceDecision;
    topScore: number | null;
    costUsd: string;
    latencyMs: number;
  }): void {
    if (!this.options.includeTrace) return;
    this.stream.send('trace', event);
  }
}
