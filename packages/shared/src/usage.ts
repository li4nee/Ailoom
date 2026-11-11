// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { PROVIDER_KINDS } from './providers.js';

/**
 * USD per million tokens, as a string: `numeric(10,4)` has at most six integer digits and four
 * decimals, and money never goes through a JavaScript float.
 */
const usdPerMtokSchema = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,4})?$/, 'Use up to 4 decimals, e.g. 0.1500');

/** One price row: a built-in from `prices.json` or a workspace override. */
export const modelPriceSchema = z.object({
  provider: z.enum(PROVIDER_KINDS),
  model: z.string().trim().min(1).max(120),
  inputPerMtokUsd: usdPerMtokSchema,
  outputPerMtokUsd: usdPerMtokSchema,
});

/** How the API returns a price row: the workspace's own rows shadow the built-in table. */
export const modelPriceDtoSchema = modelPriceSchema.extend({
  source: z.enum(['builtin', 'override']),
});

/**
 * `PUT /workspaces/:ws/model-prices` replaces the workspace's overrides wholesale. A repeated
 * (provider, model) pair is rejected here because the table's unique index would otherwise
 * answer 409 for what is really a malformed body.
 */
export const updateModelPricesSchema = z.object({
  prices: z
    .array(modelPriceSchema)
    .max(500)
    .refine(
      (rows) => new Set(rows.map((row) => `${row.provider}:${row.model}`)).size === rows.length,
      'Each provider and model may appear only once.',
    ),
});

export type ModelPrice = z.infer<typeof modelPriceSchema>;
export type ModelPriceDto = z.infer<typeof modelPriceDtoSchema>;
export type UpdateModelPricesRequest = z.infer<typeof updateModelPricesSchema>;
