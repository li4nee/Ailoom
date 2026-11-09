// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../common/config';
import { asCredentialId, asWorkspaceId } from '../db/ids';
import { createMockEmbeddingModel, createMockLanguageModel } from './mock/mock-models';
import { ProviderRegistry } from './registry';
import type { ResolvedCredential } from './types';

const config = loadConfig({
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'w'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
});

const credential = (overrides: Partial<ResolvedCredential> = {}): ResolvedCredential => ({
  id: asCredentialId('0190f5d4-7a3b-7c3d-8e9f-0a1b2c3d4e60'),
  workspaceId: asWorkspaceId('0190f5d4-7a3b-7c3d-8e9f-0a1b2c3d4e5f'),
  provider: 'mock',
  apiKey: null,
  baseUrl: null,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('ProviderRegistry', () => {
  it('serves mock models out of the box', () => {
    const registry = new ProviderRegistry(config);
    expect(registry.languageModel(credential(), 'mock-chat').modelId).toBe('mock-chat');
    expect(registry.embeddingModel(credential(), 'mock-embed').modelId).toBe('mock-embed');
  });

  it('caches a model per credential version and model id', () => {
    const registry = new ProviderRegistry(config);
    let built = 0;
    registry.register('mock', () => ({
      languageModel: (id) => {
        built += 1;
        return createMockLanguageModel({ modelId: id });
      },
    }));
    const a = registry.languageModel(credential(), 'm');
    expect(registry.languageModel(credential(), 'm')).toBe(a);
    expect(registry.languageModel(credential(), 'other')).not.toBe(a);
    expect(
      registry.languageModel(credential({ updatedAt: new Date('2026-02-01T00:00:00Z') }), 'm'),
    ).not.toBe(a);
    expect(built).toBe(3);
  });

  it('keeps chat and embedding models for the same id apart', () => {
    const registry = new ProviderRegistry(config);
    const chat = registry.languageModel(credential(), 'm');
    const embed = registry.embeddingModel(credential(), 'm');
    expect(chat).not.toBe(embed);
  });

  it('evicts the least recently used model past 100 entries', () => {
    const registry = new ProviderRegistry(config);
    const first = registry.languageModel(credential(), 'm0');
    for (let i = 1; i <= 100; i += 1) registry.languageModel(credential(), `m${String(i)}`);
    expect(registry.languageModel(credential(), 'm0')).not.toBe(first);
  });

  it('refreshes recency on a hit', () => {
    const registry = new ProviderRegistry(config);
    const first = registry.languageModel(credential(), 'm0');
    for (let i = 1; i < 100; i += 1) registry.languageModel(credential(), `m${String(i)}`);
    registry.languageModel(credential(), 'm0');
    registry.languageModel(credential(), 'm100');
    expect(registry.languageModel(credential(), 'm0')).toBe(first);
  });

  it('drops cached models when a factory is replaced', () => {
    const registry = new ProviderRegistry(config);
    const before = registry.embeddingModel(credential(), 'm');
    const replacement = createMockEmbeddingModel();
    registry.register('mock', () => ({ embeddingModel: () => replacement }));
    expect(registry.embeddingModel(credential(), 'm')).not.toBe(before);
    expect(registry.embeddingModel(credential(), 'm')).toBe(replacement);
  });

  it('rejects a provider with no registered factory', () => {
    const registry = new ProviderRegistry(config);
    expect(() => registry.languageModel(credential({ provider: 'openai' }), 'gpt')).toThrow(
      expect.objectContaining({ code: 'provider_error' }),
    );
  });

  it('rejects a model kind the provider does not offer', () => {
    const registry = new ProviderRegistry(config);
    registry.register('mock', () => ({ languageModel: () => createMockLanguageModel() }));
    expect(() => registry.embeddingModel(credential(), 'm')).toThrow(
      expect.objectContaining({ code: 'model_not_found' }),
    );
  });

  it('hands factories a fetch bound to the provider url policy', async () => {
    const registry = new ProviderRegistry(config);
    let captured: typeof fetch | undefined;
    registry.register('mock', (_c, ctx) => {
      captured = ctx.fetch;
      return { languageModel: () => createMockLanguageModel() };
    });
    registry.languageModel(credential(), 'm');
    await expect(captured?.('http://169.254.169.254/latest')).rejects.toMatchObject({
      code: 'blocked_address',
    });
  });
});
