// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { citationSchema } from './citations.js';

export const handoffSummarySchema = z.object({
  issue: z.string().max(1200),
  actionsAttempted: z.array(z.string().max(300)).max(8),
  customerFacts: z.array(z.string().max(300)).max(8),
  sentimentUrgency: z.array(z.string().max(200)).max(5),
  unresolvedQuestion: z.string().max(500).nullable(),
});

export const suggestedReplyContentSchema = z.object({
  draft: z.string().max(4000),
  insufficientContext: z.boolean(),
  citations: z.array(citationSchema).max(8),
});

export const suggestReplyRequestSchema = z.object({ idempotencyKey: z.uuid() });

/** Keeps untrusted transcript and retrieval text inside its quoted prompt block. */
export function escapeAgentAssistText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

export const suggestedReplyArtifactSchema = z.object({
  id: z.uuid(),
  kind: z.literal('suggested_reply'),
  state: z.enum(['running', 'ready', 'failed']),
  sourceThroughMessageId: z.uuid().nullable(),
  promptVersion: z.string(),
  traceId: z.uuid().nullable(),
  content: suggestedReplyContentSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});

export type HandoffSummary = z.infer<typeof handoffSummarySchema>;
export type ConversationAiArtifact = z.infer<typeof conversationAiArtifactSchema>;
export type SuggestedReplyContent = z.infer<typeof suggestedReplyContentSchema>;
export type SuggestedReplyArtifact = z.infer<typeof suggestedReplyArtifactSchema>;
