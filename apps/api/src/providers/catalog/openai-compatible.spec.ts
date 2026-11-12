// SPDX-License-Identifier: AGPL-3.0-only
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { describe, expect, it } from 'vitest';

import { asCredentialId, asWorkspaceId } from '../../db/ids';
import type { ResolvedCredential } from '../types';
import { openaiCompatible } from './openai-compatible';

function credential(over: Partial<ResolvedCredential> = {}): ResolvedCredential {
  return {
    id: asCredentialId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c01'),
    workspaceId: asWorkspaceId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c02'),
    provider: 'openai_compatible',
    apiKey: 'local-key',
    baseUrl: 'http://localhost:1234/v1',
    updatedAt: new Date(0),
    ...over,
  };
}

const agent = (): MockAgent => getGlobalDispatcher() as MockAgent;

describe('openai-compatible catalog', () => {
  it('lists models from the configured base URL with a bearer key', async () => {
    agent()
      .get('http://localhost:1234')
      .intercept({ path: '/v1/models', headers: { authorization: 'Bearer local-key' } })
      .reply(200, { data: [{ id: 'my-llm' }, { id: 'my-embedding' }] });

    expect(await openaiCompatible.listModels(credential(), fetch)).toEqual([
      { id: 'my-llm', kind: 'chat' },
      { id: 'my-embedding', kind: 'embedding' },
    ]);
  });

  it('works without a key', async () => {
    agent()
      .get('http://localhost:1234')
      .intercept({ path: '/v1/models' })
      .reply(200, { data: [{ id: 'my-llm' }] });

    expect(await openaiCompatible.listModels(credential({ apiKey: null }), fetch)).toEqual([
      { id: 'my-llm', kind: 'chat' },
    ]);
  });

  it('supports embeddings', () => {
    expect(typeof openaiCompatible.createEmbeddingModel).toBe('function');
  });
});
