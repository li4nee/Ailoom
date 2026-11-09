// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const apiRoot = resolve(__dirname, '../..');

/**
 * Vitest compiles to ES modules; this loads the provider layer the way CommonJS SWC output
 * does, which also proves the ESM-only `ai` package loads through require(esm).
 */
describe('provider layer under @swc-node/register (CommonJS)', () => {
  it('loads and embeds with the mock provider', () => {
    const script = `
      const { loadConfig } = require('./src/common/config');
      const { ProviderRegistry } = require('./src/providers');
      const config = loadConfig({
        NODE_ENV: 'test',
        PUBLIC_URL: 'http://localhost:3000',
        DATABASE_URL: 'postgres://app:app@localhost:5432/app',
        AUTH_SECRET: 'a'.repeat(32),
        WIDGET_SECRET: 'w'.repeat(32),
        ENCRYPTION_KEYS: 'v1:' + 'ab'.repeat(32),
      });
      const registry = new ProviderRegistry(config);
      registry.onModuleInit().then(() => {
        const model = registry.embeddingModel(
          { id: 'c', workspaceId: 'w', provider: 'mock', apiKey: null, baseUrl: null, updatedAt: new Date(0) },
          'mock-embed',
        );
        process.stdout.write(model.modelId);
      });
    `;
    const r = spawnSync(process.execPath, ['-r', '@swc-node/register', '-e', script], {
      cwd: apiRoot,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('mock-embed');
    expect(r.status).toBe(0);
  }, 60_000);
});
