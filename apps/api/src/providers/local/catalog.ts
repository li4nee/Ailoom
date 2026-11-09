// SPDX-License-Identifier: AGPL-3.0-only
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { LOCAL_EMBEDDING_MODEL_IDS, type LocalEmbeddingModelId } from '../../common/config';
import type { EmbedPurpose } from '../types';

/**
 * Where `pnpm --filter @app/api fetch-model` puts the models: `apps/api/models/<id>/`.
 * Source (src/) and build output (dist/) sit at the same depth below apps/api.
 */
export const DEFAULT_MODELS_DIR = resolve(__dirname, '../../../models');

/** The files every shipped model needs, relative to its directory (see models/manifest.json). */
export const MODEL_FILES = [
  'onnx/model_quantized.onnx',
  'tokenizer.json',
  'tokenizer_config.json',
  'config.json',
  'special_tokens_map.json',
] as const;

export interface LocalModelSpec {
  dimensions: number;
  /** How token vectors become one text vector; every model's output is L2-normalized. */
  pooling: 'cls' | 'mean';
  /** Text prepended to every input, by purpose. */
  prefixes: Record<EmbedPurpose, string>;
}

/** Behavior of each shipped model. models/manifest.json pins where its files come from. */
export const LOCAL_MODELS: Record<LocalEmbeddingModelId, LocalModelSpec> = {
  'bge-small-en-v1.5': {
    dimensions: 384,
    pooling: 'cls',
    prefixes: { query: '', document: '' },
  },
  // e5 is trained with these prefixes; without them retrieval quality drops noticeably.
  'multilingual-e5-small': {
    dimensions: 384,
    pooling: 'mean',
    prefixes: { query: 'query: ', document: 'passage: ' },
  },
};

export function isLocalModelId(id: string): id is LocalEmbeddingModelId {
  return (LOCAL_EMBEDDING_MODEL_IDS as readonly string[]).includes(id);
}

/** The model's directory inside `modelsDir`. */
export function localModelDir(modelsDir: string, id: LocalEmbeddingModelId): string {
  return resolve(modelsDir, id);
}

/**
 * `ready` when every file of the model exists and is non-empty. Checksums are verified by
 * fetch-model when the files are written, not on every check.
 */
export function localModelStatus(
  modelsDir: string,
  id: LocalEmbeddingModelId,
): 'ready' | 'missing' {
  const dir = localModelDir(modelsDir, id);
  for (const file of MODEL_FILES) {
    const stat = statSync(join(dir, file), { throwIfNoEntry: false });
    if (stat === undefined || !stat.isFile() || stat.size === 0) return 'missing';
  }
  return 'ready';
}

/** The text the model actually embeds for `purpose`. */
export function withPurposePrefix(
  id: LocalEmbeddingModelId,
  purpose: EmbedPurpose,
  text: string,
): string {
  return `${LOCAL_MODELS[id].prefixes[purpose]}${text}`;
}
