// SPDX-License-Identifier: AGPL-3.0-only
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { describe, expect, it } from 'vitest';

import { asCredentialId, asWorkspaceId } from '../../db/ids';
import type { ResolvedCredential } from '../types';
import { ollama } from './ollama';

function credential(baseUrl: string): ResolvedCredential {
  return {
    id: asCredentialId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c01'),
    workspaceId: asWorkspaceId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c02'),
    provider: 'ollama',
    apiKey: null,
    baseUrl,
    updatedAt: new Date(0),
  };
}

const agent = (): MockAgent => getGlobalDispatcher() as MockAgent;

describe('ollama catalog', () => {
  it('reads the model tags and drops the :latest suffix', async () => {
    agent()
      .get('http://ollama:11434')
      .intercept({ path: '/api/tags' })
      .reply(200, {
        models: [
          { name: 'llama3.1:8b' },
          { name: 'nomic-embed-text:latest' },
          { name: 'qwen2.5:0.5b' },
        ],
      });

    expect(await ollama.listModels(credential('http://ollama:11434'), fetch)).toEqual([
      { id: 'llama3.1:8b', kind: 'chat' },
      { id: 'nomic-embed-text', kind: 'embedding' },
      { id: 'qwen2.5:0.5b', kind: 'chat' },
    ]);
  });

  it('tolerates a trailing slash in the base URL', async () => {
    agent().get('http://ollama:11434').intercept({ path: '/api/tags' }).reply(200, { models: [] });

    await expect(ollama.listModels(credential('http://ollama:11434/'), fetch)).resolves.toEqual([]);
  });

  it('supports embeddings and needs no key', () => {
    expect(typeof ollama.createEmbeddingModel).toBe('function');
  });
});
