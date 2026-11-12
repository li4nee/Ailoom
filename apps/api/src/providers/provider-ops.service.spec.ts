// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../common/config';
import { asCredentialId, asWorkspaceId } from '../db/ids';
import { ProviderError } from './errors';
import { ProviderOps } from './provider-ops.service';
import type { ProviderRegistry } from './registry';
import type { ResolvedCredential, StreamChatResult } from './types';

const WS = asWorkspaceId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c02');
const ID = asCredentialId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c01');

function resolved(over: Partial<ResolvedCredential> = {}): ResolvedCredential {
  return {
    id: ID,
    workspaceId: WS,
    provider: 'mock',
    apiKey: 'sk-x',
    baseUrl: null,
    updatedAt: new Date(0),
    ...over,
  };
}

interface Fakes {
  resolver: { resolveForUse: ReturnType<typeof vi.fn> };
  status: { markUsed: ReturnType<typeof vi.fn>; markError: ReturnType<typeof vi.fn> };
  llm: { streamChat: ReturnType<typeof vi.fn>; embed: ReturnType<typeof vi.fn> };
  ops: ProviderOps;
}

function build(credential = resolved()): Fakes {
  const resolver = { resolveForUse: vi.fn(() => Promise.resolve(credential)) };
  const status = {
    markUsed: vi.fn(() => Promise.resolve(undefined)),
    markError: vi.fn(() => Promise.resolve(undefined)),
  };
  async function* textStream(): AsyncGenerator<string> {
    await Promise.resolve();
    yield 'ok';
  }
  const streamed: StreamChatResult = {
    textStream: textStream(),
    final: Promise.resolve({ inputTokens: 1, outputTokens: 1, ttftMs: 1, requestSnapshot: null }),
  };
  const llm = {
    streamChat: vi.fn(() => streamed),
    embed: vi.fn(() => Promise.resolve({ vectors: [[0.1, 0.2, 0.3]], tokens: 2 })),
  };
  const registry = { providerFetch: () => fetch } as unknown as ProviderRegistry;
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgres://app:app@localhost:5432/app',
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
  });
  const ops = new ProviderOps(resolver, status, llm as never, registry, config);
  return { resolver, status, llm, ops };
}

describe('ProviderOps', () => {
  let fakes: Fakes;

  beforeEach(() => {
    fakes = build();
  });

  it('lists the models a keyless provider offers', async () => {
    expect(await fakes.ops.listModels(WS, ID)).toEqual([
      { id: 'mock-chat', kind: 'chat' },
      { id: 'mock-embed', kind: 'embedding' },
    ]);
  });

  it('resolves the credential inside the workspace before listing', async () => {
    await fakes.ops.listModels(WS, ID);
    expect(fakes.resolver.resolveForUse).toHaveBeenCalledWith(WS, ID);
  });

  it('records a successful test as usage', async () => {
    expect(await fakes.ops.testConnection(WS, ID)).toEqual({ ok: true });
    expect(fakes.status.markUsed).toHaveBeenCalledWith(WS, ID);
    expect(fakes.status.markError).not.toHaveBeenCalled();
  });

  it('probes an embedding-only provider with one embedding', async () => {
    fakes = build(resolved({ provider: 'local' }));
    const result = await fakes.ops.testConnection(WS, ID);
    expect(result).toEqual({ ok: true });
    expect(fakes.llm.embed).toHaveBeenCalledOnce();
  });

  it('normalizes a failure and hints at host.docker.internal for a localhost URL', async () => {
    // `mock` has a fixed model list, so the probe reaches `streamChat`, not the network.
    fakes = build(resolved({ provider: 'mock', baseUrl: 'http://localhost:11434' }));
    fakes.llm.streamChat.mockImplementation(() => {
      throw new ProviderError('connection_failed');
    });

    const result = await fakes.ops.testConnection(WS, ID);
    if (result.ok) throw new Error('expected the probe to fail');

    expect(result.code).toBe('connection_failed');
    expect(result.hint).toContain('host.docker.internal');
    expect(fakes.status.markError).toHaveBeenCalledWith(WS, ID, 'connection_failed');
  });

  it('explains a blocked URL', async () => {
    fakes = build(resolved({ provider: 'mock', baseUrl: 'http://169.254.169.254' }));
    fakes.llm.streamChat.mockImplementation(() => {
      throw new ProviderError('blocked_url');
    });

    const result = await fakes.ops.testConnection(WS, ID);
    if (result.ok) throw new Error('expected the probe to fail');

    expect(result.code).toBe('blocked_url');
    expect(result.hint).toContain('ALLOW_PRIVATE_PROVIDER_URLS');
  });

  it('has no hint for a plain authentication failure', async () => {
    fakes.llm.streamChat.mockImplementation(() => {
      throw new ProviderError('auth_failed');
    });

    const result = await fakes.ops.testConnection(WS, ID);

    expect(result).toEqual({ ok: false, code: 'auth_failed', hint: null });
  });

  it('measures dimensions once per credential and model', async () => {
    const first = await fakes.ops.dimensions(WS, ID, 'mock-embed');
    const second = await fakes.ops.dimensions(WS, ID, 'mock-embed');

    expect(first).toBe(3);
    expect(second).toBe(3);
    expect(fakes.llm.embed).toHaveBeenCalledTimes(1);
  });
});
