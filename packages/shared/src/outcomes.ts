// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { usageQuerySchema } from './reports.js';

/** Outcomes are intentionally bounded more tightly than the general usage report. */
export const outcomesQuerySchema = usageQuerySchema.refine(
  (query) =>
    (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 +
      1 <=
    92,
  { message: 'The range may be at most 92 days.', path: ['to'] },
);

export const outcomeDaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  conversations: z.number().int(),
  aiResolved: z.number().int(),
  handedOff: z.number().int(),
});

export const outcomesDtoSchema = z.object({
  conversations: z.number().int(),
  pending: z.number().int(),
  handoffRate: z.number().nullable(),
  aiResolutionRate: z.number().nullable(),
  aiResolved: z.number().int(),
  handedOff: z.number().int(),
  firstHumanResponse: z.object({
    medianSeconds: z.number().nullable(),
    p90Seconds: z.number().nullable(),
    unanswered: z.number().int(),
  }),
  resolutionTime: z.object({
    medianSeconds: z.number().nullable(),
    p90Seconds: z.number().nullable(),
  }),
  csat: z.object({
    satisfiedRate: z.number().nullable(),
    averageScore: z.number().nullable(),
    responseRate: z.number().nullable(),
    ratings: z.number().int(),
  }),
  costPerResolvedUsd: z.string().nullable(),
  daily: z.array(outcomeDaySchema),
});

export type OutcomesQuery = z.infer<typeof outcomesQuerySchema>;
export type OutcomeDay = z.infer<typeof outcomeDaySchema>;
export type OutcomesDto = z.infer<typeof outcomesDtoSchema>;
