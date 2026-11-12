// SPDX-License-Identifier: AGPL-3.0-only
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

import type { ChatModel, ResolvedCredential } from '../types';
import type { ModelKind } from './classify-model';
import { getJson, trimBaseUrl } from './http';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
/** Anthropic requires the API version on every request. */
const API_VERSION = '2023-06-01';

const listSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

/** Anthropic serves chat only; bots that need embeddings use the local model instead. */
export const anthropic = {
  kind: 'anthropic' as const,
  createEmbeddingModel: null,

  createLanguageModel(
    credential: ResolvedCredential,
    modelId: string,
    fetchImpl: typeof globalThis.fetch,
  ): ChatModel {
    const provider = createAnthropic({
      ...(credential.apiKey === null ? {} : { apiKey: credential.apiKey }),
      ...(credential.baseUrl === null ? {} : { baseURL: credential.baseUrl }),
      fetch: fetchImpl,
    });
    return provider.languageModel(modelId);
  },

  async listModels(
    credential: ResolvedCredential,
    fetchImpl: typeof globalThis.fetch,
  ): Promise<{ id: string; kind: ModelKind }[]> {
    const body = await getJson(
      fetchImpl,
      `${trimBaseUrl(credential.baseUrl, DEFAULT_BASE_URL)}/v1/models`,
      {
        headers: {
          'x-api-key': credential.apiKey ?? '',
          'anthropic-version': API_VERSION,
        },
      },
      listSchema,
    );
    return body.data.map(({ id }) => ({ id, kind: 'chat' as const }));
  },
};
