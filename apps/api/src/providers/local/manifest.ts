// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { LOCAL_EMBEDDING_MODEL_IDS } from '../../common/config';

const manifestSchema = z.object({
  models: z.array(
    z.object({
      id: z.enum(LOCAL_EMBEDDING_MODEL_IDS),
      /** Hugging Face repository, e.g. `Xenova/bge-small-en-v1.5`. */
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      /** Full commit SHA; files are fetched from exactly this revision. */
      revision: z.string().regex(/^[0-9a-f]{40}$/),
      dimensions: z.number().int().positive(),
      license: z.string().min(1),
      pooling: z.enum(['cls', 'mean']),
      files: z
        .array(
          z.object({
            /** Relative path inside the repository and the model directory. */
            path: z
              .string()
              .regex(/^[\w.-]+(\/[\w.-]+)*$/)
              .refine((path) => !path.split('/').includes('..'), 'must stay inside the model'),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
          }),
        )
        .min(1),
    }),
  ),
  rerankers: z
    .array(
      z.object({
        id: z.literal('ms-marco-MiniLM-L-6-v2'),
        repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
        revision: z.string().regex(/^[0-9a-f]{40}$/),
        license: z.string().min(1),
        files: z
          .array(
            z.object({
              path: z
                .string()
                .regex(/^[\w.-]+(\/[\w.-]+)*$/)
                .refine((path) => !path.split('/').includes('..')),
              sha256: z.string().regex(/^[0-9a-f]{64}$/),
            }),
          )
          .min(1),
      }),
    )
    .default([]),
});

/** apps/api/models/manifest.json: which revision and checksums each shipped model has. */
export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestModel = Manifest['models'][number];
export type ManifestReranker = Manifest['rerankers'][number];

export function readManifest(path: string): Manifest {
  return manifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
