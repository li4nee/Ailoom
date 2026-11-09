// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APICallError } from 'ai';
import { beforeEach, describe, expect, it } from 'vitest';

import { SystemClock } from '../common/clock';
import { ConfigModule, loadConfig } from '../common/config';
import { asCredentialId, asWorkspaceId, type CredentialId, type WorkspaceId } from '../db/ids';
import { ProviderError } from './errors';
import { Llm } from './llm.service';
import { createMockEmbeddingModel, createMockLanguageModel } from './mock/mock-models';
import { ProvidersModule } from './providers.module';
import { ProviderRegistry } from './registry';
import type { CredentialResolver, ResolvedCredential } from './types';

const TEST_ENV = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'w'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
};
const config = loadConfig(TEST_ENV);

const ws = asWorkspaceId('0190f5d4-7a3b-7c3d-8e9f-0a1b2c3d4e5f');
const cid = asCredentialId('0190f5d4-7a3b-7c3d-8e9f-0a1b2c3d4e60');

class StubResolver implements CredentialResolver {
  readonly calls: [WorkspaceId, CredentialId][] = [];

  resolveForUse(workspaceId: WorkspaceId, id: CredentialId): Promise<ResolvedCredential> {
    this.calls.push([workspaceId, id]);
    return Promise.resolve({
      id,
      workspaceId,
      provider: 'mock',
      apiKey: null,
      baseUrl: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  }
}

/** A 5xx the SDK retries without its default 2 s backoff. */
const apiErr = (statusCode: number) =>
  new APICallError({
    message: 'x',
    url: 'https://p',
    requestBodyValues: {},
    statusCode,
    responseBody: 'sk-secret-123',
    responseHeaders: { 'retry-after-ms': '0' },
  });

const signal = new AbortController().signal;

describe('Llm', () => {
  let registry: ProviderRegistry;
  let resolver: StubResolver;
  let llm: Llm;

  beforeEach(async () => {
    registry = new ProviderRegistry(config);
    await registry.onModuleInit();
    resolver = new StubResolver();
    llm = new Llm(registry, resolver, new SystemClock());
  });

  const chat = (overrides: { signal?: AbortSignal } = {}) =>
    llm.streamChat({
      workspaceId: ws,
      credentialId: cid,
      model: 'mock-chat',
      messages: [{ role: 'user', content: 'refund?' }],
      maxOutputTokens: 100,
      signal: overrides.signal ?? new AbortController().signal,
    });

  const collect = async (stream: AsyncIterable<string>): Promise<string> => {
    let text = '';
    for await (const d of stream) text += d;
    return text;
  };

  describe('streamChat', () => {
    it('streams text and resolves usage, ttft and snapshot', async () => {
      const r = chat();
      const text = await collect(r.textStream);
      const f = await r.final;
      expect(text).toBe('Mock answer about "refund?" [1].');
      expect(f.inputTokens).toBeGreaterThan(0);
      expect(f.outputTokens).toBe(Math.ceil(text.length / 4));
      expect(f.ttftMs).toBeGreaterThanOrEqual(0);
      expect(f.requestSnapshot).toBeDefined();
      expect(JSON.stringify(f.requestSnapshot)).toContain('refund?');
    });

    it('resolves final even when nobody reads the stream', async () => {
      const f = await chat().final;
      expect(f.outputTokens).toBeGreaterThan(0);
    });

    it('resolves the credential within the workspace', async () => {
      await chat().final;
      expect(resolver.calls).toEqual([[ws, cid]]);
    });

    it('streams the reply in chunks', async () => {
      const model = createMockLanguageModel({ chunkSize: 3, reply: () => 'abcdefgh' });
      registry.register('mock', () => ({ languageModel: () => model }));
      const r = chat();
      const deltas: string[] = [];
      for await (const d of r.textStream) deltas.push(d);
      expect(deltas).toEqual(['abc', 'def', 'gh']);
      await r.final;
    });

    it('retries chat exactly once', async () => {
      const model = createMockLanguageModel({ failWith: apiErr(500) });
      registry.register('mock', () => ({ languageModel: () => model }));
      const r = chat();
      await expect(collect(r.textStream)).rejects.toMatchObject({ code: 'provider_error' });
      await expect(r.final).rejects.toBeInstanceOf(ProviderError);
      await expect(r.final).rejects.toMatchObject({ code: 'provider_error', status: 500 });
      expect(model.doStreamCalls).toHaveLength(2);
    });

    it('maps provider errors', async () => {
      const model = createMockLanguageModel({ failWith: apiErr(401) });
      registry.register('mock', () => ({ languageModel: () => model }));
      const r = chat();
      await expect(r.final).rejects.toMatchObject({ code: 'auth_failed' });
      expect(model.doStreamCalls).toHaveLength(1);
    });

    it('maps a caller abort to aborted', async () => {
      const model = createMockLanguageModel({ delayMs: 50 });
      registry.register('mock', () => ({ languageModel: () => model }));
      const controller = new AbortController();
      const r = chat({ signal: controller.signal });
      setTimeout(() => {
        controller.abort();
      }, 10);
      await expect(collect(r.textStream)).rejects.toMatchObject({ code: 'aborted' });
      await expect(r.final).rejects.toMatchObject({ code: 'aborted' });
    });

    it('fails with timeout when the call exceeds the time limit', async () => {
      llm = new Llm(registry, resolver, new SystemClock(), 30);
      registry.register('mock', () => ({
        languageModel: () => createMockLanguageModel({ delayMs: 200 }),
      }));
      const r = chat();
      await expect(collect(r.textStream)).rejects.toMatchObject({ code: 'timeout' });
      await expect(r.final).rejects.toMatchObject({ code: 'timeout' });
    });

    it('measures ttft when the first delta arrives, not when it is read', async () => {
      registry.register('mock', () => ({
        // ~32 one-character deltas 10 ms apart: the whole answer takes ~330 ms.
        languageModel: () => createMockLanguageModel({ delayMs: 10, chunkSize: 1 }),
      }));
      const r = chat();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await collect(r.textStream);
      const f = await r.final;
      expect(f.ttftMs).toBeLessThan(100);
    });

    it('maps a failing provider factory without leaking its message', async () => {
      registry.register('mock', () => {
        throw new TypeError('bad base url http://u:pw@h');
      });
      const r = chat();
      await expect(collect(r.textStream)).rejects.toBeInstanceOf(ProviderError);
      const error: unknown = await r.final.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ code: 'provider_error' });
      expect((error as ProviderError).safeMessage).not.toContain('pw');
      expect((error as ProviderError).message).not.toContain('pw');
    });

    it('passes credential resolution errors through unchanged', async () => {
      const notFound = new Error('not_found');
      llm = new Llm(registry, { resolveForUse: () => Promise.reject(notFound) }, new SystemClock());
      await expect(chat().final).rejects.toBe(notFound);
    });

    it('rejects final without an unhandled rejection when nobody reads the stream', async () => {
      const model = createMockLanguageModel({ failWith: apiErr(401) });
      registry.register('mock', () => ({ languageModel: () => model }));
      await expect(chat().final).rejects.toMatchObject({ code: 'auth_failed' });
    });
  });

  describe('embed', () => {
    it('embeds deterministically', async () => {
      const a = await llm.embed({
        workspaceId: ws,
        credentialId: cid,
        model: 'mock-embed',
        inputs: ['x', 'y'],
        signal,
      });
      const b = await llm.embed({
        workspaceId: ws,
        credentialId: cid,
        model: 'mock-embed',
        inputs: ['x'],
        signal,
      });
      expect(a.vectors[0]).toEqual(b.vectors[0]);
      expect(a.vectors[0]).toHaveLength(384);
      expect(a.vectors[0]).not.toEqual(a.vectors[1]);
      expect(a.tokens).toBeGreaterThan(0);
    });

    it('returns unit vectors of the configured dimensions', async () => {
      const model = createMockEmbeddingModel({ dimensions: 8 });
      registry.register('mock', () => ({ embeddingModel: () => model }));
      const { vectors } = await llm.embed({
        workspaceId: ws,
        credentialId: cid,
        model: 'mock-embed',
        inputs: ['hello'],
        signal,
      });
      const [vector] = vectors;
      expect(vector).toHaveLength(8);
      const norm = Math.hypot(...(vector ?? []));
      expect(norm).toBeCloseTo(1, 10);
    });

    it('fails with timeout when embedding exceeds the time limit', async () => {
      llm = new Llm(registry, resolver, new SystemClock(), 30);
      registry.register('mock', () => ({
        embeddingModel: () => createMockEmbeddingModel({ delayMs: 200 }),
      }));
      await expect(
        llm.embed({ workspaceId: ws, credentialId: cid, model: 'm', inputs: ['x'], signal }),
      ).rejects.toMatchObject({ code: 'timeout' });
    });

    it('maps a failing provider factory without leaking its message', async () => {
      registry.register('mock', () => {
        throw new TypeError('bad base url http://u:pw@h');
      });
      const error: unknown = await llm
        .embed({ workspaceId: ws, credentialId: cid, model: 'm', inputs: ['x'], signal })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).safeMessage).not.toContain('pw');
    });

    it('does not retry embeddings', async () => {
      const model = createMockEmbeddingModel({ failWith: apiErr(500) });
      registry.register('mock', () => ({ embeddingModel: () => model }));
      await expect(
        llm.embed({ workspaceId: ws, credentialId: cid, model: 'm', inputs: ['x'], signal }),
      ).rejects.toMatchObject({ code: 'provider_error' });
      expect(model.doEmbedCalls).toHaveLength(1);
    });
  });

  describe('ProvidersModule', () => {
    it('wires Llm with the given credential resolver', async () => {
      @Module({
        imports: [
          ConfigModule.forRoot(config),
          ProvidersModule.forRoot({ resolver: StubResolver }),
        ],
      })
      // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest root module
      class RootModule {}
      const ctx = await NestFactory.createApplicationContext(RootModule, { logger: false });
      try {
        const result = await ctx.get(Llm).embed({
          workspaceId: ws,
          credentialId: cid,
          model: 'mock-embed',
          inputs: ['x'],
          signal,
        });
        expect(result.vectors).toHaveLength(1);
      } finally {
        await ctx.close();
      }
    });
  });
});
