// SPDX-License-Identifier: AGPL-3.0-only
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

import { ProviderError } from '../errors';
import type { ChatModel, EmbeddingModel, ResolvedCredential } from '../types';
import { classifyModelId, type ModelKind } from './classify-model';
import { getJson, trimBaseUrl } from './http';

const listSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

/** vLLM, LM Studio, OpenRouter and friends: any endpoint speaking the OpenAI API. */
export const openaiCompatible = {
  kind: 'openai_compatible' as const,

  createLanguageModel(
    credential: ResolvedCredential,
    modelId: string,
    fetchImpl: typeof globalThis.fetch,
  ): ChatModel {
    return provider(credential, fetchImpl).languageModel(modelId);
  },

  createEmbeddingModel(
    credential: ResolvedCredential,
    modelId: string,
    fetchImpl: typeof globalThis.fetch,
  ): EmbeddingModel {
    return provider(credential, fetchImpl).embeddingModel(modelId);
  },

  async listModels(
    credential: ResolvedCredential,
    fetchImpl: typeof globalThis.fetch,
  ): Promise<{ id: string; kind: ModelKind }[]> {
    const body = await getJson(
      fetchImpl,
      `${baseUrl(credential)}/models`,
      credential.apiKey === null
        ? {}
        : { headers: { authorization: `Bearer ${credential.apiKey}` } },
      listSchema,
    );
    return body.data.flatMap(({ id }) => {
      const kind = classifyModelId(id);
      return kind === 'skip' ? [] : [{ id, kind }];
    });
  },
};

function baseUrl(credential: ResolvedCredential): string {
  if (credential.baseUrl === null) throw new ProviderError('provider_error');
  return trimBaseUrl(credential.baseUrl, '');
}

function provider(credential: ResolvedCredential, fetchImpl: typeof globalThis.fetch) {
  return createOpenAICompatible({
    name: 'openai-compatible',
    baseURL: baseUrl(credential),
    ...(credential.apiKey === null ? {} : { apiKey: credential.apiKey }),
    includeUsage: true,
    fetch: fetchImpl,
  });
}
