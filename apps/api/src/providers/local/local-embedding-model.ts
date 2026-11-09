// SPDX-License-Identifier: AGPL-3.0-only
import type {
  EmbeddingModelV4,
  EmbeddingModelV4CallOptions,
  EmbeddingModelV4Result,
} from '@ai-sdk/provider';
import type { FeatureExtractionPipeline, Tensor } from '@huggingface/transformers';

import type { LocalEmbeddingModelId } from '../../common/config';
import { ProviderError } from '../errors';
import type { EmbedPurpose } from '../types';
import { LOCAL_MODELS, localModelDir, withPurposePrefix } from './catalog';

/** Texts per `doEmbed` call; `embedMany` splits larger inputs into calls of this size. */
const DEFAULT_BATCH_SIZE = 16;

type Transformers = typeof import('@huggingface/transformers');

let transformers: Promise<Transformers> | undefined;

/**
 * Loads the library on first use, so a process that never embeds locally never pays for
 * the ONNX runtime. Under CommonJS this resolves to the library's CommonJS build.
 */
function loadTransformers(): Promise<Transformers> {
  transformers ??= import('@huggingface/transformers').then((lib) => {
    // Models come only from the directory fetch-model filled; never from the network.
    lib.env.allowRemoteModels = false;
    lib.env.allowLocalModels = true;
    lib.env.useFSCache = false;
    return lib;
  });
  return transformers;
}

/** One pipeline per model directory per process, created on first use. */
const pipelines = new Map<string, Promise<FeatureExtractionPipeline>>();

function loadPipeline(dir: string): Promise<FeatureExtractionPipeline> {
  let pipeline = pipelines.get(dir);
  if (pipeline === undefined) {
    pipeline = (async () => {
      const lib = await loadTransformers();
      // An absolute path is read as a local directory, not as a Hub repository id.
      // `q8` selects onnx/model_quantized.onnx.
      return lib.pipeline('feature-extraction', dir, { dtype: 'q8', device: 'cpu' });
    })().catch(() => {
      // Let a later call retry (e.g. after fetch-model ran). Like every ProviderError, the
      // cause (which names local paths) is not kept.
      pipelines.delete(dir);
      throw new ProviderError('local_model_unavailable');
    });
    pipelines.set(dir, pipeline);
  }
  return pipeline;
}

/** `providerOptions.local.purpose`, set by `Llm.embed`; anything else counts as `document`. */
function purposeOf(options: EmbeddingModelV4CallOptions['providerOptions']): EmbedPurpose {
  return options?.['local']?.['purpose'] === 'query' ? 'query' : 'document';
}

/** Rows of a `[n, dimensions]` float tensor. */
function rows(output: Tensor): number[][] {
  const [count = 0, dimensions = 0] = output.dims;
  const data = output.data;
  if (!(data instanceof Float32Array) || output.dims.length !== 2) {
    throw new ProviderError('provider_error');
  }
  return Array.from({ length: count }, (_, i) =>
    Array.from(data.subarray(i * dimensions, (i + 1) * dimensions)),
  );
}

/** Tokens the model saw (after truncation), counted from the attention mask. */
function countTokens(extractor: FeatureExtractionPipeline, texts: string[]): number {
  const { attention_mask: mask } = extractor.tokenizer(texts, { padding: true, truncation: true });
  let tokens = 0;
  for (const value of mask.data) tokens += Number(value);
  return tokens;
}

export interface LocalEmbeddingModelOptions {
  /** Directory holding one sub-directory per model (`<modelsDir>/<id>/`). */
  modelsDir: string;
  id: LocalEmbeddingModelId;
  /** `maxEmbeddingsPerCall`; `embedMany` splits larger inputs. Defaults to 16. */
  batchSize?: number;
}

/**
 * An AI SDK embedding model running in-process with ONNX (spec 11.3). Vectors are pooled per
 * model (CLS or mean) and L2-normalized. `providerOptions.local.purpose` picks e5's prefix.
 */
export function createLocalEmbeddingModel(opts: LocalEmbeddingModelOptions): EmbeddingModelV4 {
  const spec = LOCAL_MODELS[opts.id];
  const dir = localModelDir(opts.modelsDir, opts.id);
  return {
    specificationVersion: 'v4',
    provider: 'local',
    modelId: opts.id,
    maxEmbeddingsPerCall: opts.batchSize ?? DEFAULT_BATCH_SIZE,
    // One in-process session per model: parallel batches would only contend for the CPU.
    supportsParallelCalls: false,
    async doEmbed(options: EmbeddingModelV4CallOptions): Promise<EmbeddingModelV4Result> {
      const { values, abortSignal } = options;
      abortSignal?.throwIfAborted();
      if (values.length === 0) return { embeddings: [], usage: { tokens: 0 }, warnings: [] };
      const extractor = await loadPipeline(dir);
      const purpose = purposeOf(options.providerOptions);
      const texts = values.map((value) => withPurposePrefix(opts.id, purpose, value));
      const embeddings: number[][] = [];
      // One inference per text. The quantized models scale activations over the whole input
      // tensor, so in a padded batch a text's vector would shift with its batch-mates
      // (cosine ~0.996); alone, a text always gets the same vector. Without padding it is
      // also faster on CPU. A running inference cannot be interrupted, so an abort is
      // honored between texts.
      for (const text of texts) {
        abortSignal?.throwIfAborted();
        const [vector] = rows(await extractor(text, { pooling: spec.pooling, normalize: true }));
        if (vector === undefined) throw new ProviderError('provider_error');
        embeddings.push(vector);
      }
      abortSignal?.throwIfAborted();
      return { embeddings, usage: { tokens: countTokens(extractor, texts) }, warnings: [] };
    },
  };
}
