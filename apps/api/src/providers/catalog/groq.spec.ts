// SPDX-License-Identifier: AGPL-3.0-only
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { describe, expect, it } from 'vitest';

import { asCredentialId, asWorkspaceId } from '../../db/ids';
import type { ResolvedCredential } from '../types';
import { groq } from './groq';

const credential: ResolvedCredential = {
  id: asCredentialId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c01'),
  workspaceId: asWorkspaceId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c02'),
  provider: 'groq',
  apiKey: 'gsk-x',
  baseUrl: null,
  updatedAt: new Date(0),
};

const agent = (): MockAgent => getGlobalDispatcher() as MockAgent;

describe('groq catalog', () => {
  it('lists chat models from the openai-compatible endpoint', async () => {
    agent()
      .get('https://api.groq.com')
      .intercept({ path: '/openai/v1/models', headers: { authorization: 'Bearer gsk-x' } })
      .reply(200, { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3' }] });

    expect(await groq.listModels(credential, fetch)).toEqual([
      { id: 'llama-3.3-70b-versatile', kind: 'chat' },
    ]);
  });

  it('has no embedding factory', () => {
    expect(groq.createEmbeddingModel).toBeNull();
  });
});
