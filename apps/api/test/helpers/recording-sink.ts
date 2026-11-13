// SPDX-License-Identifier: AGPL-3.0-only
import type { Citation, ErrorCode, NoAnswerBehavior, TraceDecision } from '@app/shared';

import type { AnswerSink } from '../../src/modules/chat/answer-sink';
import type { EscalationReason } from '../../src/modules/chat/domain/escalation';

export type SinkCall =
  | { kind: 'accepted'; messageId: string; createdAt: string }
  | { kind: 'started'; messageId: string }
  | { kind: 'delta'; text: string }
  | { kind: 'completed'; messageId: string; content: string; citations: Citation[] }
  | {
      kind: 'escalated';
      messageId: string;
      reason: EscalationReason;
      behavior: NoAnswerBehavior;
      content: string;
    }
  | { kind: 'handoffOffered'; messageId: string; reason: 'handoff_intent' }
  | { kind: 'error'; code: ErrorCode; message: string }
  | {
      kind: 'trace';
      traceId: string;
      decision: TraceDecision;
      topScore: number | null;
      costUsd: string;
      latencyMs: number;
    };

/** Records every sink call in order; the orchestrator tests assert the sequence. */
export class RecordingSink implements AnswerSink {
  readonly calls: SinkCall[] = [];

  accepted(event: { messageId: string; createdAt: string }): void {
    this.calls.push({ kind: 'accepted', ...event });
  }

  started(event: { messageId: string }): void {
    this.calls.push({ kind: 'started', ...event });
  }

  delta(text: string): void {
    this.calls.push({ kind: 'delta', text });
  }

  completed(event: { messageId: string; content: string; citations: Citation[] }): void {
    this.calls.push({ kind: 'completed', ...event });
  }

  escalated(event: {
    messageId: string;
    reason: EscalationReason;
    behavior: NoAnswerBehavior;
    content: string;
  }): void {
    this.calls.push({ kind: 'escalated', ...event });
  }

  handoffOffered(event: { messageId: string; reason: 'handoff_intent' }): void {
    this.calls.push({ kind: 'handoffOffered', ...event });
  }

  error(event: { code: ErrorCode; message: string }): void {
    this.calls.push({ kind: 'error', ...event });
  }

  trace(event: {
    traceId: string;
    decision: TraceDecision;
    topScore: number | null;
    costUsd: string;
    latencyMs: number;
  }): void {
    this.calls.push({ kind: 'trace', ...event });
  }

  kinds(): string[] {
    return this.calls.map((call) => call.kind);
  }

  /** The most recent call of `kind`; fails loudly when there is none. */
  last<K extends SinkCall['kind']>(kind: K): Extract<SinkCall, { kind: K }> {
    const found = [...this.calls].reverse().find((call) => call.kind === kind);
    if (found === undefined) throw new Error(`no ${kind} call; had ${this.kinds().join(', ')}`);
    return found as Extract<SinkCall, { kind: K }>;
  }

  all(kind: SinkCall['kind']): SinkCall[] {
    return this.calls.filter((call) => call.kind === kind);
  }
}
