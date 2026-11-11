// SPDX-License-Identifier: AGPL-3.0-only
import type { ProviderKind } from '@app/shared';

import type { ChatModel, EmbeddingModel, ResolvedCredential } from '../types';
import { anthropic } from './anthropic';
import type { ModelKind } from './classify-model';
import { gemini } from './gemini';
import { groq } from './groq';
import { mistral } from './mistral';
import { ollama } from './ollama';
import { openai } from './openai';
import { openaiCompatible } from './openai-compatible';

export { classifyModelId, type ModelKind } from './classify-model';

/** One provider's model constructors plus the REST call that lists its models. */
export interface CatalogProvider {
  kind: ProviderKind;
  createLanguageModel(
    credential: ResolvedCredential,
    modelId: string,
    fetchImpl: typeof globalThis.fetch,
  ): ChatModel;
  /** `null` when the provider cannot embed (Anthropic, Groq). */
  createEmbeddingModel:
    | ((
        credential: ResolvedCredential,
        modelId: string,
        fetchImpl: typeof globalThis.fetch,
      ) => EmbeddingModel)
    | null;
  listModels(
    credential: ResolvedCredential,
    fetchImpl: typeof globalThis.fetch,
  ): Promise<{ id: string; kind: ModelKind }[]>;
}

/** Providers reached over HTTP with a workspace credential; `local` and `mock` are not. */
export type ByokProviderKind = Exclude<ProviderKind, 'local' | 'mock'>;

/** Every BYOK provider, one entry each. */
export const CATALOG: Record<ByokProviderKind, CatalogProvider> = {
  openai,
  anthropic,
  gemini,
  groq,
  mistral,
  ollama,
  openai_compatible: openaiCompatible,
};
