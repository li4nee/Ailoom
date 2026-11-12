// SPDX-License-Identifier: AGPL-3.0-only
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { describe, expect, it } from 'vitest';

import { asCredentialId, asWorkspaceId } from '../../db/ids';
import type { ResolvedCredential } from '../types';
import { anthropic } from './anthropic';

const credential: ResolvedCredential = {
  id: asCredentialId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c01'),
  workspaceId: asWorkspaceId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c02'),
  provider: 'anthropic',
  apiKey: 'sk-ant-x',
  baseUrl: null,
  updatedAt: new Date(0),
};

const agent = (): MockAgent => getGlobalDispatcher() as MockAgent;

describe('anthropic catalog', () => {
  it('lists chat models with the key and version in headers', async () => {
    agent()
      .get('https://api.anthropic.com')
      .intercept({
        path: '/v1/models',
        headers: { 'x-api-key': 'sk-ant-x', 'anthropic-version': '2023-06-01' },
      })
      .reply(200, { data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-haiku-4-5' }] });

    expect(await anthropic.listModels(credential, fetch)).toEqual([
      { id: 'claude-sonnet-4-5', kind: 'chat' },
      { id: 'claude-haiku-4-5', kind: 'chat' },
    ]);
  });

  it('has no embedding factory', () => {
    expect(anthropic.createEmbeddingModel).toBeNull();
  });
});
