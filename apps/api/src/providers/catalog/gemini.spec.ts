// SPDX-License-Identifier: AGPL-3.0-only
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { describe, expect, it } from 'vitest';

import { asCredentialId, asWorkspaceId } from '../../db/ids';
import type { ResolvedCredential } from '../types';
import { gemini } from './gemini';

const credential: ResolvedCredential = {
  id: asCredentialId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c01'),
  workspaceId: asWorkspaceId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c02'),
  provider: 'gemini',
  apiKey: 'gem-key',
  baseUrl: null,
  updatedAt: new Date(0),
};

const agent = (): MockAgent => getGlobalDispatcher() as MockAgent;

describe('gemini catalog', () => {
  it('sends the key in a header and never in the URL', async () => {
    const requested: string[] = [];
    agent()
      .get('https://generativelanguage.googleapis.com')
      .intercept({
        path: (path) => {
          requested.push(path);
          return path.startsWith('/v1beta/models');
        },
        headers: { 'x-goog-api-key': 'gem-key' },
      })
      .reply(200, {
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        ],
      });

    const models = await gemini.listModels(credential, fetch);
    expect(models).toEqual([{ id: 'gemini-2.5-flash', kind: 'chat' }]);
    expect(requested.length).toBeGreaterThan(0);
    for (const path of requested) expect(path).not.toContain('key=');
  });

  it('requires the x-goog-api-key header', async () => {
    agent()
      .get('https://generativelanguage.googleapis.com')
      .intercept({
        path: (path) => path.startsWith('/v1beta/models'),
        headers: { 'x-goog-api-key': 'gem-key' },
      })
      .reply(200, { models: [] });

    await expect(gemini.listModels(credential, fetch)).resolves.toEqual([]);
  });

  it('strips the models/ prefix and maps generation methods to kinds', async () => {
    agent()
      .get('https://generativelanguage.googleapis.com')
      .intercept({ path: (path) => path.startsWith('/v1beta/models') })
      .reply(200, {
        models: [
          { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/learnlm-1.5-pro', supportedGenerationMethods: ['countTokens'] },
        ],
      });

    expect(await gemini.listModels(credential, fetch)).toEqual([
      { id: 'gemini-embedding-001', kind: 'embedding' },
      { id: 'text-embedding-004', kind: 'embedding' },
      { id: 'gemini-2.5-pro', kind: 'chat' },
    ]);
  });

  it('supports embeddings', () => {
    expect(typeof gemini.createEmbeddingModel).toBe('function');
  });
});
