// SPDX-License-Identifier: AGPL-3.0-only
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

import type { ChatModel, EmbeddingModel, ResolvedCredential } from '../types';
import type { ModelKind } from './classify-model';
import { getJson, trimBaseUrl } from './http';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

const listSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      supportedGenerationMethods: z.array(z.string()).optional(),
    }),
  ),
});

export const gemini = {
  kind: 'gemini' as const,

  createLanguageModel(
    credential: ResolvedCredential,
    modelId: string,
    fetchImpl: typeof globalThis.fetch,
  ): ChatModel {
    const provider = createGoogleGenerativeAI({
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
    const provider = createGoogleGenerativeAI({
      ...(credential.apiKey === null ? {} : { apiKey: credential.apiKey }),
      ...(credential.baseUrl === null ? {} : { baseURL: credential.baseUrl }),
      fetch: fetchImpl,
    });
    return provider.embeddingModel(modelId);
  },

  /**
   * The key travels in `x-goog-api-key`, never in the query string: a URL ends up in logs,
   * proxies and error messages. Model names come back as `models/<id>`.
   */
  async listModels(
    credential: ResolvedCredential,
    fetchImpl: typeof globalThis.fetch,
  ): Promise<{ id: string; kind: ModelKind }[]> {
    const body = await getJson(
      fetchImpl,
      `${trimBaseUrl(credential.baseUrl, DEFAULT_BASE_URL)}/v1beta/models`,
      { headers: { 'x-goog-api-key': credential.apiKey ?? '' } },
      listSchema,
    );
    return body.models.flatMap(({ name, supportedGenerationMethods = [] }) => {
      const kind: ModelKind | null = supportedGenerationMethods.includes('generateContent')
        ? 'chat'
        : supportedGenerationMethods.includes('embedContent')
          ? 'embedding'
          : null;
      return kind === null ? [] : [{ id: name.replace(/^models\//, ''), kind }];
    });
  },
};
