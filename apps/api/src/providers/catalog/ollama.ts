// SPDX-License-Identifier: AGPL-3.0-only
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

import { ProviderError } from '../errors';
import type { ChatModel, EmbeddingModel, ResolvedCredential } from '../types';
import { classifyModelId, type ModelKind } from './classify-model';
import { getJson, trimBaseUrl } from './http';

const tagsSchema = z.object({
  models: z.array(z.object({ name: z.string() })),
});

/** Ollama reports every tag as `name:latest` when no tag was given. */
function withoutLatestTag(name: string): string {
  return name.replace(/:latest$/, '');
}

/**
 * Ollama through its OpenAI-compatible API (`<base>/v1`), per spec §11.3: no community
 * package. The instance is keyless, and the model list comes from Ollama's own `/api/tags`.
 */
export const ollama = {
  kind: 'ollama' as const,

  createLanguageModel(
    credential: ResolvedCredential,
    modelId: string,
    fetchImpl: typeof globalThis.fetch,
  ): ChatModel {
    return ollamaProvider(credential, fetchImpl).languageModel(modelId);
  },

  createEmbeddingModel(
    credential: ResolvedCredential,
    modelId: string,
    fetchImpl: typeof globalThis.fetch,
  ): EmbeddingModel {
    return ollamaProvider(credential, fetchImpl).embeddingModel(modelId);
  },

  async listModels(
    credential: ResolvedCredential,
    fetchImpl: typeof globalThis.fetch,
  ): Promise<{ id: string; kind: ModelKind }[]> {
    const body = await getJson(fetchImpl, `${baseUrl(credential)}/api/tags`, {}, tagsSchema);
    return body.models.flatMap(({ name }) => {
      const id = withoutLatestTag(name);
      const kind = classifyModelId(id);
      return kind === 'skip' ? [] : [{ id, kind }];
    });
  },
};

function baseUrl(credential: ResolvedCredential): string {
  if (credential.baseUrl === null) throw new ProviderError('provider_error');
  return trimBaseUrl(credential.baseUrl, '');
}

function ollamaProvider(credential: ResolvedCredential, fetchImpl: typeof globalThis.fetch) {
  return createOpenAICompatible({
    name: 'ollama',
    baseURL: `${baseUrl(credential)}/v1`,
    includeUsage: true,
    fetch: fetchImpl,
  });
}
