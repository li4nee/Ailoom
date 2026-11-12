// SPDX-License-Identifier: AGPL-3.0-only
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { describe, expect, it } from 'vitest';

import { asCredentialId, asWorkspaceId } from '../../db/ids';
import type { ResolvedCredential } from '../types';
import { mistral } from './mistral';

const credential: ResolvedCredential = {
  id: asCredentialId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c01'),
  workspaceId: asWorkspaceId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c02'),
  provider: 'mistral',
  apiKey: 'mis-x',
  baseUrl: null,
  updatedAt: new Date(0),
};

const agent = (): MockAgent => getGlobalDispatcher() as MockAgent;

describe('mistral catalog', () => {
  it('lists chat and embedding models separately', async () => {
    agent()
      .get('https://api.mistral.ai')
      .intercept({ path: '/v1/models', headers: { authorization: 'Bearer mis-x' } })
      .reply(200, {
        object: 'list',
        data: [
          { id: 'mistral-small-latest' },
          { id: 'mistral-embed' },
          { id: 'open-mixtral-8x7b' },
        ],
      });

    expect(await mistral.listModels(credential, fetch)).toEqual([
      { id: 'mistral-small-latest', kind: 'chat' },
      { id: 'mistral-embed', kind: 'embedding' },
      { id: 'open-mixtral-8x7b', kind: 'chat' },
    ]);
  });

  it('supports embeddings', () => {
    expect(typeof mistral.createEmbeddingModel).toBe('function');
  });
});
