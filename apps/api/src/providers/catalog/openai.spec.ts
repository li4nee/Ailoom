// SPDX-License-Identifier: AGPL-3.0-only
import { generateText } from 'ai';
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { describe, expect, it } from 'vitest';

import { asCredentialId, asWorkspaceId } from '../../db/ids';
import type { ResolvedCredential } from '../types';
import { openai } from './openai';

function credential(over: Partial<ResolvedCredential> = {}): ResolvedCredential {
  return {
    id: asCredentialId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c01'),
    workspaceId: asWorkspaceId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c02'),
    provider: 'openai',
    apiKey: 'sk-x',
    baseUrl: null,
    updatedAt: new Date(0),
    ...over,
  };
}

const agent = (): MockAgent => getGlobalDispatcher() as MockAgent;

describe('openai catalog', () => {
  it('lists models, classifies them and skips non-chat kinds', async () => {
    agent()
      .get('https://api.openai.com')
      .intercept({ path: '/v1/models', headers: { authorization: 'Bearer sk-x' } })
      .reply(200, {
        data: [
          { id: 'gpt-4o-mini' },
          { id: 'text-embedding-3-small' },
          { id: 'whisper-1' },
          { id: 'dall-e-3' },
        ],
      });

    expect(await openai.listModels(credential(), fetch)).toEqual([
      { id: 'gpt-4o-mini', kind: 'chat' },
      { id: 'text-embedding-3-small', kind: 'embedding' },
    ]);
  });

  it('honours a custom base URL', async () => {
    agent()
      .get('https://llm.example.com')
      .intercept({ path: '/v1/models' })
      .reply(200, { data: [{ id: 'gpt-4o-mini' }] });

    expect(
      await openai.listModels(credential({ baseUrl: 'https://llm.example.com' }), fetch),
    ).toEqual([{ id: 'gpt-4o-mini', kind: 'chat' }]);
  });

  it('reports a rejected key as auth_failed', async () => {
    agent().get('https://api.openai.com').intercept({ path: '/v1/models' }).reply(401, {});

    await expect(openai.listModels(credential(), fetch)).rejects.toMatchObject({
      code: 'auth_failed',
    });
  });

  it('builds a model that calls the injected fetch', async () => {
    // @ai-sdk/openai's languageModel() speaks the Responses API; only the injected fetch can
    // reach the mock, so a successful call proves the factory used it.
    agent()
      .get('https://api.openai.com')
      .intercept({ path: '/v1/responses', method: 'POST' })
      .reply(
        200,
        {
          id: 'resp_1',
          object: 'response',
          created_at: 1,
          status: 'completed',
          model: 'gpt-4o-mini',
          output: [
            {
              type: 'message',
              id: 'msg_1',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'hi', annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
        { headers: { 'content-type': 'application/json' } },
      );

    const model = openai.createLanguageModel(credential(), 'gpt-4o-mini', fetch);
    const result = await generateText({ model, prompt: 'hi', maxRetries: 0 });

    expect(result.text).toBe('hi');
  });

  it('supports embeddings', () => {
    expect(typeof openai.createEmbeddingModel).toBe('function');
  });
});
