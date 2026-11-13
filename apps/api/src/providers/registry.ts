// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';

import type { ProviderKind } from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../common/config';
import { type FetchPolicy, providerPolicy, safeFetch } from '../common/safe-fetch';
import { CATALOG, type ByokProviderKind, type CatalogProvider } from './catalog';
import { ProviderError } from './errors';
import { createLocalProvider, DEFAULT_MODELS_DIR } from './local';
import { ModelCatalog } from './model-catalog';
import {
  type ChatModel,
  type EmbeddingModel,
  LOCAL_MODELS_DIR,
  type ProviderFactory,
  type ProviderFactoryContext,
  type ProviderModels,
  type ResolvedCredential,
} from './types';

const CACHE_SIZE = 100;

const MOCK_MODELS_MODULE = './mock/mock-models';
type MockModelsModule = typeof import('./mock/mock-models');

/**
 * Loads the mock models on demand. Compiled CommonJS (tsc or SWC output, `.js`) uses
 * `require`. Sources run as TypeScript: under @swc-node/register SWC turns the `import()`
 * of a non-literal specifier into `require()`; under Vitest it stays an ES import, the only
 * way Vitest resolves a `.ts` file. A literal `import()` would make tsc demand an ESM-style
 * `.js` path, and tsc keeps `import()` as a real ES import that cannot resolve an
 * extensionless path in dist.
 */
async function loadMockModels(): Promise<MockModelsModule> {
  if (__filename.endsWith('.js')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
    return require(MOCK_MODELS_MODULE) as MockModelsModule;
  }
  return (await import(MOCK_MODELS_MODULE)) as MockModelsModule;
}

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

/** Adapts a catalog entry to the registry's factory shape; it also carries `listModels`. */
function catalogFactory(catalog: CatalogProvider): ProviderFactory {
  const embedding = catalog.createEmbeddingModel;
  return (credential, context) => ({
    languageModel: (modelId) => catalog.createLanguageModel(credential, modelId, context.fetch),
    ...(embedding === null
      ? {}
      : {
          embeddingModel: (modelId: string) => embedding(credential, modelId, context.fetch),
        }),
  });
}

function toUrl(input: Parameters<typeof fetch>[0]): string | URL {
  return typeof input === 'string' || input instanceof URL ? input : input.url;
}

/**
 * Builds AI SDK model instances from resolved credentials. Instances are cached per credential
 * version (`updatedAt`), so a rotated key or base URL never reuses a stale client.
 */
@Injectable()
export class ProviderRegistry implements OnModuleInit {
  private readonly factories = new Map<ProviderKind, ProviderFactory>();
  private readonly cache = new LruCache<CachedModel>(CACHE_SIZE);
  private readonly context: ProviderFactoryContext;
  private readonly offersMock: boolean;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional() @Inject(LOCAL_MODELS_DIR) modelsDir: string = DEFAULT_MODELS_DIR,
  ) {
    this.offersMock = config.nodeEnv !== 'production';
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
    // Built in, needs no credential secrets; the ONNX runtime loads on the first embedding.
    this.register('local', createLocalProvider({ modelsDir, enabled: config.localEmbeddings }));
    // Every provider reached over HTTP with a workspace credential.
    for (const [kind, catalog] of Object.entries(CATALOG)) {
      this.register(kind as ByokProviderKind, catalogFactory(catalog));
    }
  }

  /**
   * Registers the mock provider outside production (spec: dev/test only). It is imported
   * lazily so production never loads `ai/test`; a `mock` credential there is `provider_error`.
   */
  async onModuleInit(): Promise<void> {
    if (!this.offersMock || this.factories.has('mock')) return;
    const { createMockEmbeddingModel, createMockLanguageModel } = await loadMockModels();
    this.register('mock', () => ({
      languageModel: (modelId) => createMockLanguageModel({ modelId }),
      // Match the catalog width, so a two-model test can tell vectors apart by size.
      embeddingModel: (modelId) => {
        const info = ModelCatalog.embedding('mock', modelId);
        return createMockEmbeddingModel(
          info === null ? { modelId } : { modelId, dimensions: info.dimensions },
        );
      },
    }));
  }

  /**
   * The provider-policy fetch, for catalog calls made outside a model (REST model lists).
   * Sharing it keeps every outbound provider request on the same SSRF policy.
   */
  providerFetch(): typeof globalThis.fetch {
    return this.context.fetch;
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
