// SPDX-License-Identifier: AGPL-3.0-only
import type { PreTrainedModel, PreTrainedTokenizer, Tensor } from '@huggingface/transformers';
import { Injectable } from '@nestjs/common';

import { DEFAULT_MODELS_DIR } from '../../providers/local/catalog';
import type { Reranker } from './reranker';
import type { RetrievedChunk } from './retrieval.repository';

const MODEL_ID = 'ms-marco-MiniLM-L-6-v2';
const MAX_PASSAGE_CHARS = 6000;

interface CrossEncoder {
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
}
let transformers: Promise<typeof import('@huggingface/transformers')> | undefined;
const instances = new Map<string, Promise<CrossEncoder>>();

async function load(dir: string): Promise<CrossEncoder> {
  let instance = instances.get(dir);
  if (instance === undefined) {
    instance = (async () => {
      transformers ??= import('@huggingface/transformers').then((lib) => {
        lib.env.allowRemoteModels = false;
        lib.env.allowLocalModels = true;
        lib.env.useFSCache = false;
        return lib;
      });
      const lib = await transformers;
      const modelDir = `${dir}/${MODEL_ID}`;
      const [tokenizer, model] = await Promise.all([
        lib.AutoTokenizer.from_pretrained(modelDir, { local_files_only: true }),
        lib.AutoModelForSequenceClassification.from_pretrained(modelDir, {
          local_files_only: true,
          dtype: 'q8',
          device: 'cpu',
        }),
      ]);
      return { tokenizer, model };
    })().catch((error: unknown) => {
      instances.delete(dir);
      throw error;
    });
    instances.set(dir, instance);
  }
  return instance;
}

/** CPU-only, in-process MS MARCO cross-encoder. It never downloads files at runtime. */
@Injectable()
export class LocalCrossEncoderReranker implements Reranker {
  async score(
    query: string,
    passages: readonly RetrievedChunk[],
    signal: AbortSignal,
  ): Promise<number[]> {
    signal.throwIfAborted();
    const { tokenizer, model } = await load(DEFAULT_MODELS_DIR);
    const scores: number[] = [];
    for (const passage of passages) {
      signal.throwIfAborted();
      const inputs = tokenizer(query, {
        text_pair: passage.content.slice(0, MAX_PASSAGE_CHARS),
        truncation: true,
        max_length: 512,
      });
      const result = (await model._call(inputs)) as { logits?: Tensor };
      const logits = result.logits?.data;
      if (!(logits instanceof Float32Array) || logits.length === 0)
        throw new Error('invalid_reranker_output');
      const value = logits[0];
      if (value === undefined || !Number.isFinite(value))
        throw new Error('invalid_reranker_output');
      scores.push(value);
    }
    signal.throwIfAborted();
    return scores;
  }
}
