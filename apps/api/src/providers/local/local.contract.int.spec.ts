// SPDX-License-Identifier: AGPL-3.0-only
// Needs the real model files: run `pnpm --filter @app/api fetch-model` first.
import { beforeAll } from 'vitest';

import { SystemClock } from '../../common/clock';
import { LOCAL_EMBEDDING_MODEL_IDS, loadConfig } from '../../common/config';
import { asCredentialId, asWorkspaceId } from '../../db/ids';
import { runEmbeddingContract } from '../__contract__/embedding-contract';
import { Llm } from '../llm.service';
import { ProviderRegistry } from '../registry';
import type { CredentialResolver, ResolvedCredential } from '../types';
import { DEFAULT_MODELS_DIR, LOCAL_MODELS, localModelStatus } from './catalog';

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
      provider: 'local',
      apiKey: null,
      baseUrl: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }),
};

beforeAll(() => {
  for (const id of LOCAL_EMBEDDING_MODEL_IDS) {
    if (localModelStatus(DEFAULT_MODELS_DIR, id) !== 'ready') {
      throw new Error(`${id} is missing: run \`pnpm --filter @app/api fetch-model\` first`);
    }
  }
});

// The local provider has no chat model: only the embedding contract applies, once per model.
for (const model of LOCAL_EMBEDDING_MODEL_IDS) {
  runEmbeddingContract(`local ${model}`, () => ({
    llm: new Llm(new ProviderRegistry(config), resolver, new SystemClock()),
    credentialId,
    workspaceId,
    model,
    dimensions: LOCAL_MODELS[model].dimensions,
  }));
}
