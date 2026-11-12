// SPDX-License-Identifier: AGPL-3.0-only
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';

import type { ChatModel, ResolvedCredential } from '../types';
import { classifyModelId, type ModelKind } from './classify-model';
import { getJson, trimBaseUrl } from './http';

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

const listSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

/** Groq serves chat only (whisper is a skip: it is not a chat or embedding model). */
export const groq = {
  kind: 'groq' as const,
  createEmbeddingModel: null,

  createLanguageModel(
    credential: ResolvedCredential,
    modelId: string,
    fetchImpl: typeof globalThis.fetch,
  ): ChatModel {
    const provider = createGroq({
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
      `${trimBaseUrl(credential.baseUrl, DEFAULT_BASE_URL)}/models`,
      { headers: { authorization: `Bearer ${credential.apiKey ?? ''}` } },
      listSchema,
    );
    return body.data.flatMap(({ id }) => {
      const kind = classifyModelId(id);
      return kind === 'skip' ? [] : [{ id, kind }];
    });
  },
};
