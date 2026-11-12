// SPDX-License-Identifier: AGPL-3.0-only
import { createMistral } from '@ai-sdk/mistral';
import { z } from 'zod';

import type { ChatModel, EmbeddingModel, ResolvedCredential } from '../types';
import { classifyModelId, type ModelKind } from './classify-model';
import { getJson, trimBaseUrl } from './http';

const DEFAULT_BASE_URL = 'https://api.mistral.ai';

const listSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

export const mistral = {
  kind: 'mistral' as const,

  createLanguageModel(
    credential: ResolvedCredential,
    modelId: string,
    fetchImpl: typeof globalThis.fetch,
  ): ChatModel {
    const provider = createMistral({
      ...(credential.apiKey === null ? {} : { apiKey: credential.apiKey }),
      ...(credential.baseUrl === null ? {} : { baseURL: credential.baseUrl }),
      fetch: fetchImpl,
    });
    return provider.languageModel(modelId);
  },

  createEmbeddingModel(
    credential: ResolvedCredential,
    modelId: string,
    fetchImpl: typeof globalThis.fetch,
  ): EmbeddingModel {
    const provider = createMistral({
      ...(credential.apiKey === null ? {} : { apiKey: credential.apiKey }),
      ...(credential.baseUrl === null ? {} : { baseURL: credential.baseUrl }),
      fetch: fetchImpl,
    });
    return provider.embeddingModel(modelId);
  },

  async listModels(
    credential: ResolvedCredential,
    fetchImpl: typeof globalThis.fetch,
  ): Promise<{ id: string; kind: ModelKind }[]> {
    const body = await getJson(
      fetchImpl,
      `${trimBaseUrl(credential.baseUrl, DEFAULT_BASE_URL)}/v1/models`,
      { headers: { authorization: `Bearer ${credential.apiKey ?? ''}` } },
      listSchema,
    );
    return body.data.flatMap(({ id }) => {
      const kind = classifyModelId(id);
      return kind === 'skip' ? [] : [{ id, kind }];
    });
  },
};
