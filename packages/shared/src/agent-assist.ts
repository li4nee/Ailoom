// SPDX-License-Identifier: MIT
import { z } from 'zod';

export const handoffSummarySchema = z.object({
  issue: z.string().max(1200),
  actionsAttempted: z.array(z.string().max(300)).max(8),
  customerFacts: z.array(z.string().max(300)).max(8),
  sentimentUrgency: z.array(z.string().max(200)).max(5),
  unresolvedQuestion: z.string().max(500).nullable(),
});

export const conversationAiArtifactSchema = z.object({
  id: z.uuid(),
  kind: z.literal('handoff_summary'),
  state: z.enum(['queued', 'running', 'ready', 'failed']),
  sourceThroughMessageId: z.uuid().nullable(),
  promptVersion: z.string(),
  traceId: z.uuid().nullable(),
  content: handoffSummarySchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});

export type HandoffSummary = z.infer<typeof handoffSummarySchema>;
export type ConversationAiArtifact = z.infer<typeof conversationAiArtifactSchema>;
