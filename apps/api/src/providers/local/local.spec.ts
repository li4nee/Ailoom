// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../common/config';
import { LOCAL_EMBEDDING_MODEL_IDS } from '../../common/config/config.schema';
import { asCredentialId, asWorkspaceId } from '../../db/ids';
import { ProviderRegistry } from '../registry';
import type { ResolvedCredential } from '../types';
import {
  DEFAULT_MODELS_DIR,
  LOCAL_MODELS,
  localModelStatus,
  MODEL_FILES,
  withPurposePrefix,
} from './catalog';
import { readManifest } from './manifest';

const config = loadConfig({
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'w'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
});

const localCred: ResolvedCredential = {
  id: asCredentialId('0190f5d4-7a3b-7c3d-8e9f-0a1b2c3d4e60'),
  workspaceId: asWorkspaceId('0190f5d4-7a3b-7c3d-8e9f-0a1b2c3d4e5f'),
  provider: 'local',
  apiKey: null,
  baseUrl: null,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const tempDirs: string[] = [];

/** A models directory holding non-empty placeholder files for `id`, minus `omit`. */
function fakeModelsDir(id: string, omit: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'ailoom-models-'));
  tempDirs.push(dir);
  for (const file of MODEL_FILES) {
    if (omit.includes(file)) continue;
    const path = join(dir, id, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'x');
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('local model catalog', () => {
  it('reports missing files', () => {
    expect(localModelStatus('/nonexistent', 'bge-small-en-v1.5')).toBe('missing');
  });

  it('is ready only when every file of that model is present', () => {
    const dir = fakeModelsDir('multilingual-e5-small');
    expect(localModelStatus(dir, 'multilingual-e5-small')).toBe('ready');
    expect(localModelStatus(dir, 'bge-small-en-v1.5')).toBe('missing');
    const partial = fakeModelsDir('bge-small-en-v1.5', ['onnx/model_quantized.onnx']);
    expect(localModelStatus(partial, 'bge-small-en-v1.5')).toBe('missing');
  });

  it('describes every configurable model', () => {
    expect(Object.keys(LOCAL_MODELS).sort()).toEqual([...LOCAL_EMBEDDING_MODEL_IDS].sort());
  });

  it('agrees with the committed manifest', () => {
    const manifest = readManifest(join(DEFAULT_MODELS_DIR, 'manifest.json'));
    expect(manifest.models.map((m) => m.id).sort()).toEqual([...LOCAL_EMBEDDING_MODEL_IDS].sort());
    for (const entry of manifest.models) {
      const spec = LOCAL_MODELS[entry.id];
      expect(entry).toMatchObject({
        dimensions: spec.dimensions,
        pooling: spec.pooling,
        license: 'MIT',
      });
      expect(entry.repo).toBe(`Xenova/${entry.id}`);
      expect(entry.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.files.map((f) => f.path).sort()).toEqual([...MODEL_FILES].sort());
      for (const file of entry.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('prefixes e5 inputs by purpose and leaves bge inputs alone', () => {
    expect(withPurposePrefix('multilingual-e5-small', 'query', 'refund?')).toBe('query: refund?');
    expect(withPurposePrefix('multilingual-e5-small', 'document', 'Refunds')).toBe(
      'passage: Refunds',
    );
    expect(withPurposePrefix('bge-small-en-v1.5', 'query', 'refund?')).toBe('refund?');
    expect(withPurposePrefix('bge-small-en-v1.5', 'document', 'Refunds')).toBe('Refunds');
  });
});

describe('local provider in the registry', () => {
  it('throws local_model_unavailable when the model files are missing', () => {
    const registry = new ProviderRegistry(config, '/nonexistent');
    expect(() => registry.embeddingModel({ ...localCred }, 'bge-small-en-v1.5')).toThrow(
      expect.objectContaining({ code: 'local_model_unavailable' }),
    );
  });

  it('throws local_model_unavailable when local embeddings are disabled', () => {
    const dir = fakeModelsDir('bge-small-en-v1.5');
    const registry = new ProviderRegistry({ ...config, localEmbeddings: false }, dir);
    expect(() => registry.embeddingModel(localCred, 'bge-small-en-v1.5')).toThrow(
      expect.objectContaining({ code: 'local_model_unavailable' }),
    );
  });

  it('serves every shipped model whose files exist', () => {
    const dir = fakeModelsDir('multilingual-e5-small');
    const registry = new ProviderRegistry(config, dir);
    const model = registry.embeddingModel(localCred, 'multilingual-e5-small');
    expect(model).toMatchObject({
      provider: 'local',
      modelId: 'multilingual-e5-small',
      maxEmbeddingsPerCall: 16,
    });
    expect(() => registry.embeddingModel(localCred, 'bge-small-en-v1.5')).toThrow(
      expect.objectContaining({ code: 'local_model_unavailable' }),
    );
  });

  it('rejects unknown models and chat', () => {
    const registry = new ProviderRegistry(config, fakeModelsDir('bge-small-en-v1.5'));
    expect(() => registry.embeddingModel(localCred, 'text-embedding-3-small')).toThrow(
      expect.objectContaining({ code: 'model_not_found' }),
    );
    expect(() => registry.languageModel(localCred, 'bge-small-en-v1.5')).toThrow(
      expect.objectContaining({ code: 'model_not_found' }),
    );
  });
});
