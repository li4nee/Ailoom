// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll } from 'vitest';

import { SystemClock } from '../../common/clock';
import { loadConfig } from '../../common/config';
import { asCredentialId, asWorkspaceId } from '../../db/ids';
import { runChatContract } from '../__contract__/chat-contract';
import { runEmbeddingContract } from '../__contract__/embedding-contract';
import { Llm } from '../llm.service';
import { ProviderRegistry } from '../registry';
import type { CredentialResolver, ResolvedCredential } from '../types';
import { createMockLanguageModel } from './mock-models';

const config = loadConfig({
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'w'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
});

const workspaceId = asWorkspaceId('0190f5d4-7a3b-7c3d-8e9f-0a1b2c3d4e5f');
const credentialId = asCredentialId('0190f5d4-7a3b-7c3d-8e9f-0a1b2c3d4e60');

const resolver: CredentialResolver = {
  resolveForUse: (): Promise<ResolvedCredential> =>
    Promise.resolve({
      id: credentialId,
      workspaceId,
      provider: 'mock',
      apiKey: null,
      baseUrl: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }),
};

/**
 * A reply of 232 characters (58 mock tokens, under the contract's 64-token output limit), so
 * the slow stream below runs for about 1.5 s.
 */
const LONG_REPLY = 'Refunds are issued within five business days of approval. '.repeat(4);

/**
 * A mock that streams four characters every 25 ms. Left running, the reply would take well
 * over the contract's 1000 ms abort deadline, so only a real abort can end it in time.
 */
function slowChatLlm(): Llm {
  const registry = new ProviderRegistry(config);
  registry.register('mock', () => ({
    languageModel: (modelId) =>
      createMockLanguageModel({ modelId, delayMs: 25, chunkSize: 4, reply: () => LONG_REPLY }),
  }));
  return new Llm(registry, resolver, new SystemClock());
}

runChatContract('mock', () => ({
  llm: slowChatLlm(),
  credentialId,
  workspaceId,
  model: 'mock-chat',
}));

// The registry adds the mock provider on module init, as Nest does at startup.
const registry = new ProviderRegistry(config);
beforeAll(() => registry.onModuleInit());

runEmbeddingContract('mock', () => ({
  llm: new Llm(registry, resolver, new SystemClock()),
  credentialId,
  workspaceId,
  model: 'mock-embed',
  dimensions: 384,
}));
