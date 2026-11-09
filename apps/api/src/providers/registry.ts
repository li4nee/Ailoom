// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';

import type { ProviderKind } from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../common/config';
import { type FetchPolicy, providerPolicy, safeFetch } from '../common/safe-fetch';
import { ProviderError } from './errors';
import { createMockEmbeddingModel, createMockLanguageModel } from './mock/mock-models';
import type {
  ChatModel,
  EmbeddingModel,
  ProviderFactory,
  ProviderFactoryContext,
  ProviderModels,
  ResolvedCredential,
} from './types';

const CACHE_SIZE = 100;

/**
 * A minimal LRU on `Map` insertion order: a hit re-inserts the key, and the first key is the
 * least recently used. Small enough not to warrant a dependency.
 */
class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done !== true) this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

type CachedModel =
  { kind: 'chat'; model: ChatModel } | { kind: 'embedding'; model: EmbeddingModel };

function toUrl(input: Parameters<typeof fetch>[0]): string | URL {
  return typeof input === 'string' || input instanceof URL ? input : input.url;
}

/**
 * Builds AI SDK model instances from resolved credentials. Instances are cached per credential
 * version (`updatedAt`), so a rotated key or base URL never reuses a stale client.
 */
@Injectable()
export class ProviderRegistry {
  private readonly factories = new Map<ProviderKind, ProviderFactory>();
  private readonly cache = new LruCache<CachedModel>(CACHE_SIZE);
  private readonly context: ProviderFactoryContext;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const policy: FetchPolicy = providerPolicy(config);
    this.context = {
      fetch: (input, init) => {
        const { signal, ...rest } = init ?? {};
        return safeFetch(
          toUrl(input),
          signal === undefined || signal === null ? rest : { ...rest, signal },
          policy,
        );
      },
    };
    this.register('mock', () => ({
      languageModel: (modelId) => createMockLanguageModel({ modelId }),
      embeddingModel: (modelId) => createMockEmbeddingModel({ modelId }),
    }));
  }

  /** Adds or replaces the factory for `kind`; cached models are dropped. */
  register(kind: ProviderKind, factory: ProviderFactory): void {
    this.factories.set(kind, factory);
    this.cache.clear();
  }

  languageModel(credential: ResolvedCredential, modelId: string): ChatModel {
    const key = this.key('chat', credential, modelId);
    const hit = this.cache.get(key);
    if (hit?.kind === 'chat') return hit.model;
    const build = this.provider(credential).languageModel;
    if (build === undefined) throw new ProviderError('model_not_found');
    const model = build(modelId);
    this.cache.set(key, { kind: 'chat', model });
    return model;
  }

  embeddingModel(credential: ResolvedCredential, modelId: string): EmbeddingModel {
    const key = this.key('embedding', credential, modelId);
    const hit = this.cache.get(key);
    if (hit?.kind === 'embedding') return hit.model;
    const build = this.provider(credential).embeddingModel;
    if (build === undefined) throw new ProviderError('model_not_found');
    const model = build(modelId);
    this.cache.set(key, { kind: 'embedding', model });
    return model;
  }

  private key(kind: CachedModel['kind'], credential: ResolvedCredential, modelId: string): string {
    return `${kind}:${credential.id}:${String(credential.updatedAt.getTime())}:${modelId}`;
  }

  private provider(credential: ResolvedCredential): ProviderModels {
    const factory = this.factories.get(credential.provider);
    if (factory === undefined) throw new ProviderError('provider_error');
    return factory(credential, this.context);
  }
}
