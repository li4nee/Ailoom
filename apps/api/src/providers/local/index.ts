// SPDX-License-Identifier: AGPL-3.0-only
import { ProviderError } from '../errors';
import type { ProviderFactory } from '../types';
import { isLocalModelId, localModelStatus } from './catalog';
import { createLocalEmbeddingModel } from './local-embedding-model';

export {
  DEFAULT_MODELS_DIR,
  LOCAL_MODELS,
  localModelStatus,
  MODEL_FILES,
  type LocalModelSpec,
} from './catalog';
export {
  createLocalEmbeddingModel,
  type LocalEmbeddingModelOptions,
} from './local-embedding-model';

export interface LocalProviderOptions {
  modelsDir: string;
  /** `LOCAL_EMBEDDINGS`; when false every local model is unavailable. */
  enabled: boolean;
}

/**
 * The built-in `local` provider: embeddings only, served from every shipped model whose files
 * are present. A missing model is `local_model_unavailable`, an unknown one `model_not_found`.
 */
export function createLocalProvider(opts: LocalProviderOptions): ProviderFactory {
  return () => ({
    embeddingModel: (modelId) => {
      if (!isLocalModelId(modelId)) throw new ProviderError('model_not_found');
      if (!opts.enabled || localModelStatus(opts.modelsDir, modelId) !== 'ready') {
        throw new ProviderError('local_model_unavailable');
      }
      return createLocalEmbeddingModel({ modelsDir: opts.modelsDir, id: modelId });
    },
  });
}
