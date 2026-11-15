// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { pageQuerySchema } from './pagination.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

/** `GET …/usage`: both ends are inclusive UTC days, at most 366 days apart. */
export const usageQuerySchema = z
  .object({
    from: day,
    to: day,
    botId: z.uuid().optional(),
  })
  .refine((query) => query.from <= query.to, {
    message: '`from` must not be after `to`.',
    path: ['from'],
  })
  .refine(
    (query) =>
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 +
        1 <=
      366,
    { message: 'The range may be at most 366 days.', path: ['to'] },
  );

export const usageDaySchema = z.object({
  day,
  conversations: z.number().int(),
  visitorMessages: z.number().int(),
  aiMessages: z.number().int(),
  escalations: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  embeddingTokens: z.number().int(),
  costUsd: z.string(),
});

export const usageReportSchema = z.object({
  days: z.array(usageDaySchema),
  totals: usageDaySchema.omit({ day: true }),
  feedback: z.object({
    positive: z.number().int(),
    negative: z.number().int(),
    positiveRate: z.number().nullable(),
  }),
  monthToDate: z
    .object({
      costUsd: z.string(),
      capUsd: z.string(),
    })
    .nullable(),
});

/** `GET …/unanswered`: visitor messages the bot escalated for lack of knowledge. */
export const unansweredQuerySchema = pageQuerySchema.extend({
  botId: z.uuid().optional(),
});

export const unansweredItemSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  botId: z.string(),
  content: z.string(),
  topScore: z.number().nullable(),
  createdAt: z.string(),
});

/** `GET …/feedback`: AI answers with the requested thumbs rating. */
export const feedbackQuerySchema = pageQuerySchema.extend({
  rating: z
    .enum(['-1', '1'])
    .default('-1')
    .transform((value) => Number(value) as 1 | -1),
  botId: z.uuid().optional(),
});

export const feedbackItemSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  content: z.string(),
  traceId: z.string().nullable(),
  feedbackAt: z.string().nullable(),
});

export type UsageQuery = z.infer<typeof usageQuerySchema>;
export type UsageDay = z.infer<typeof usageDaySchema>;
export type UsageReport = z.infer<typeof usageReportSchema>;
export type UnansweredQuery = z.infer<typeof unansweredQuerySchema>;
export type UnansweredItem = z.infer<typeof unansweredItemSchema>;
export type FeedbackQuery = z.infer<typeof feedbackQuerySchema>;
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;
