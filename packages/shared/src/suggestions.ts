// SPDX-License-Identifier: MIT
import { z } from 'zod';

export const SUGGESTION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const agentReviewSchema = z.object({
  verdict: z.enum(['correct', 'incorrect']),
  correctedAnswer: z.string().nullable(),
  reviewerId: z.uuid(),
  reviewedAt: z.iso.datetime(),
  suggestionId: z.uuid().nullable(),
});

export const knowledgeSuggestionSchema = z.object({
  id: z.uuid(),
  botId: z.uuid(),
  botName: z.string(),
  messageId: z.uuid().nullable(),
  conversationId: z.uuid().nullable(),
  question: z.string(),
  answer: z.string(),
  status: z.enum(SUGGESTION_STATUSES),
  createdBy: z.object({ id: z.uuid(), name: z.string().nullable() }).nullable(),
  reviewedBy: z.object({ id: z.uuid(), name: z.string().nullable() }).nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  rejectReason: z.string().nullable(),
  sourceId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export const incorrectReviewSchema = z.object({
  verdict: z.literal('incorrect'),
  question: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(4000),
});

export const correctReviewSchema = z.object({ verdict: z.literal('correct') });
export const reviewAnswerSchema = z.discriminatedUnion('verdict', [
  correctReviewSchema,
  incorrectReviewSchema,
]);

export const reviewAnswerResponseSchema = z.object({
  review: agentReviewSchema,
  suggestion: knowledgeSuggestionSchema.nullable(),
});

export const knowledgeSuggestionQuerySchema = z.object({
  status: z.enum(SUGGESTION_STATUSES).optional(),
  botId: z.uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const approveSuggestionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  question: z.string().trim().min(1).max(1000).optional(),
  answer: z.string().trim().min(1).max(4000).optional(),
});

export const rejectSuggestionSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const approveSuggestionResponseSchema = z.object({
  suggestion: knowledgeSuggestionSchema,
  sourceId: z.uuid(),
});

export type AgentReview = z.infer<typeof agentReviewSchema>;
export type KnowledgeSuggestionDto = z.infer<typeof knowledgeSuggestionSchema>;
export type ReviewAnswerRequest = z.infer<typeof reviewAnswerSchema>;
export type ReviewAnswerResponse = z.infer<typeof reviewAnswerResponseSchema>;
export type KnowledgeSuggestionQuery = z.infer<typeof knowledgeSuggestionQuerySchema>;
export type ApproveSuggestionRequest = z.infer<typeof approveSuggestionSchema>;
export type RejectSuggestionRequest = z.infer<typeof rejectSuggestionSchema>;
export type ApproveSuggestionResponse = z.infer<typeof approveSuggestionResponseSchema>;
