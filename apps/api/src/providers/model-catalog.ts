// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { PROVIDER_KINDS } from '@app/shared';

/**
 * The shipped model facts (spec §9.4) and price table (spec §9.5), validated on load: a typo in
 * either file fails the first import instead of surfacing as a missing dimension at runtime.
 *
 * Read from disk rather than imported: under `@swc-node/register` a JSON import resolves to
 * `undefined` (CommonJS interop), and the build copies `data/` into `dist/` alongside this file.
 */

const providerSchema = z.enum(PROVIDER_KINDS);

/** `provider:model`; the provider half must be one the instance can resolve a credential for. */
const catalogKeySchema = z.string().refine((key) => {
  const colon = key.indexOf(':');
  return colon > 0 && providerSchema.safeParse(key.slice(0, colon)).success;
}, 'Model keys must look like provider:model with a known provider.');

export const modelsFileSchema = z.object({
  embedding: z.record(
    catalogKeySchema,
    z.object({
      dimensions: z.number().int().positive(),
      /** `null` when a model has no calibrated default; callers use `defaultThreshold`. */
      threshold: z.number().min(0).max(1).nullable(),
    }),
  ),
  chat: z.record(
    catalogKeySchema,
    z.object({
      contextWindow: z.number().int().positive(),
      /** Explicitly reviewed capability; unknown/custom model IDs are never assumed compatible. */
      toolCalling: z.boolean().default(false),
    }),
  ),
});

/** A provider-keyed table; only the providers that have prices need to appear. */
function byProvider<T extends z.ZodType>(value: T) {
  return z.record(z.string(), value).superRefine((rows, ctx) => {
    for (const provider of Object.keys(rows)) {
      if (!providerSchema.safeParse(provider).success) {
        ctx.addIssue({
          code: 'custom',
          path: [provider],
          message: `"${provider}" is not a provider kind`,
        });
      }
    }
  });
}

export const pricesFileSchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  prices: byProvider(
    z.record(z.string(), z.object({ input: z.number().min(0), output: z.number().min(0) })),
  ),
});

export type ModelsFile = z.infer<typeof modelsFileSchema>;
export type PricesFile = z.infer<typeof pricesFileSchema>;

function readData(name: 'models.json' | 'prices.json'): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'data', name), 'utf8')) as unknown;
}

export const MODELS: ModelsFile = modelsFileSchema.parse(readData('models.json'));
export const BUILTIN_PRICES: PricesFile = pricesFileSchema.parse(readData('prices.json'));

/** Used whenever a model's own threshold has not been calibrated yet. */
export const DEFAULT_RETRIEVAL_THRESHOLD = 0.35;

export interface EmbeddingModelInfo {
  dimensions: number;
  threshold: number;
}

/**
 * Lookups into the shipped model table. An unknown model is `null`: the caller measures the
 * width from the provider (Task 2.8) rather than guessing.
 */
export const ModelCatalog = {
  defaultThreshold: DEFAULT_RETRIEVAL_THRESHOLD,
  supportsToolCalling(provider: string, model: string): boolean {
    return MODELS.chat[`${provider}:${model}`]?.toolCalling === true;
  },
  embedding(provider: string, model: string): EmbeddingModelInfo | null {
    const info = MODELS.embedding[`${provider}:${model}`];
    if (info === undefined) return null;
    return {
      dimensions: info.dimensions,
      threshold: info.threshold ?? DEFAULT_RETRIEVAL_THRESHOLD,
    };
  },
} as const;
