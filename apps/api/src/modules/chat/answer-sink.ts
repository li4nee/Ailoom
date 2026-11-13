// SPDX-License-Identifier: AGPL-3.0-only
import type { Citation, ErrorCode, NoAnswerBehavior, TraceDecision } from '@app/shared';

import type { EscalationReason } from './domain/escalation';

/**
 * Where one answer attempt reports its progress (spec §18.2). The orchestrator never throws
 * for an expected outcome; it describes it here, and an SSE controller or a test sink decides
 * how to show it.
 */
export interface AnswerSink {
  accepted(event: { messageId: string; createdAt: string }): void;
  started(event: { messageId: string }): void;
  delta(text: string): void;
  completed(event: { messageId: string; content: string; citations: Citation[] }): void;
  escalated(event: {
    messageId: string;
    reason: EscalationReason;
    behavior: NoAnswerBehavior;
    content: string;
  }): void;
  handoffOffered(event: { messageId: string; reason: 'handoff_intent' }): void;
  error(event: { code: ErrorCode; message: string }): void;
  /** Playground only: the trace of the attempt, once it is committed. */
  trace?(event: {
    traceId: string;
    decision: TraceDecision;
    topScore: number | null;
    costUsd: string;
    latencyMs: number;
  }): void;
}
