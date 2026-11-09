// SPDX-License-Identifier: AGPL-3.0-only
// Needs the real model files: run `pnpm --filter @app/api fetch-model` first.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { embedMany } from 'ai';
import { beforeAll, describe, expect, it } from 'vitest';

import { SystemClock } from '../../common/clock';
import { loadConfig } from '../../common/config';
import { asCredentialId, asWorkspaceId } from '../../db/ids';
import { Llm } from '../llm.service';
import { ProviderRegistry } from '../registry';
import type { CredentialResolver, EmbedRequest, ResolvedCredential } from '../types';
import { DEFAULT_MODELS_DIR, localModelStatus } from './catalog';
import { createLocalEmbeddingModel } from './local-embedding-model';

const config = loadConfig({
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'w'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
});

const ws = asWorkspaceId('0190f5d4-7a3b-7c3d-8e9f-0a1b2c3d4e5f');
const cid = asCredentialId('0190f5d4-7a3b-7c3d-8e9f-0a1b2c3d4e60');

const localResolver: CredentialResolver = {
  resolveForUse: (): Promise<ResolvedCredential> =>
    Promise.resolve({
      id: cid,
      workspaceId: ws,
      provider: 'local',
      apiKey: null,
      baseUrl: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }),
};

/** Dot product; equal to the cosine similarity for unit vectors. */
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
const norm = (v: number[]) => Math.hypot(...v);

beforeAll(() => {
  for (const id of ['bge-small-en-v1.5', 'multilingual-e5-small'] as const) {
    if (localModelStatus(DEFAULT_MODELS_DIR, id) !== 'ready') {
      throw new Error(`${id} is missing: run \`pnpm --filter @app/api fetch-model\` first`);
    }
  }
});

describe('bge-small-en-v1.5', () => {
  const model = createLocalEmbeddingModel({
    modelsDir: DEFAULT_MODELS_DIR,
    id: 'bge-small-en-v1.5',
  });

  it('returns 384-dim unit vectors', async () => {
    const { embeddings, usage } = await embedMany({ model, values: ['hello'] });
    expect(embeddings[0]).toHaveLength(384);
    expect(Math.abs(norm(embeddings[0] ?? []) - 1)).toBeLessThan(1e-3);
    expect(usage.tokens).toBeGreaterThan(0);
  });

  it('is deterministic', async () => {
    const a = await embedMany({ model, values: ['The quick brown fox'] });
    const b = await embedMany({ model, values: ['The quick brown fox'] });
    expect(a.embeddings).toEqual(b.embeddings);
  });

  it('ranks related text higher', async () => {
    const [q, rel, unrel] = (
      await embedMany({
        model,
        values: [
          'How do I get a refund?',
          'Refund policy: you can return items within 30 days for a full refund.',
          'Our office is located in Berlin.',
        ],
      })
    ).embeddings;
    expect(cos(q ?? [], rel ?? [])).toBeGreaterThan(cos(q ?? [], unrel ?? []) + 0.1);
  });

  it('handles batches larger than the per-call limit', async () => {
    const values = Array.from({ length: 40 }, (_, i) => `t${String(i)}`);
    const { embeddings } = await embedMany({ model, values });
    expect(embeddings).toHaveLength(40);
    // A text's vector does not depend on what it is batched with.
    const alone = await embedMany({ model, values: ['t39'] });
    expect(embeddings[39]).toEqual(alone.embeddings[0]);
  });
});

describe('multilingual-e5-small through Llm', () => {
  const registry = new ProviderRegistry(config);
  const llm = new Llm(registry, localResolver, new SystemClock());
  const embed = (inputs: string[], purpose?: EmbedRequest['purpose']) =>
    llm.embed({
      workspaceId: ws,
      credentialId: cid,
      model: 'multilingual-e5-small',
      inputs,
      signal: new AbortController().signal,
      ...(purpose === undefined ? {} : { purpose }),
    });

  it('returns 384-dim unit vectors', async () => {
    const { vectors } = await embed(['hello', 'hallo']);
    for (const v of vectors) {
      expect(v).toHaveLength(384);
      expect(Math.abs(norm(v) - 1)).toBeLessThan(1e-3);
    }
  });

  it('applies the query and passage prefixes by purpose', async () => {
    const text = 'How do I get a refund?';
    const [asDocument] = (await embed([text])).vectors;
    const [asQuery] = (await embed([text], 'query')).vectors;
    const [explicitDocument] = (await embed([text], 'document')).vectors;
    expect(asDocument).toEqual(explicitDocument);
    expect(asQuery).not.toEqual(asDocument);
  });

  it('ranks a related German document above an unrelated one', async () => {
    const [q] = (await embed(['Wie bekomme ich eine Rückerstattung?'], 'query')).vectors;
    const [rel, unrel] = (
      await embed([
        'Rückerstattung: Sie können Artikel innerhalb von 30 Tagen gegen volle Erstattung zurückgeben.',
        'Unser Büro ist in Berlin.',
      ])
    ).vectors;
    expect(cos(q ?? [], rel ?? [])).toBeGreaterThan(cos(q ?? [], unrel ?? []) + 0.05);
  });

  it('ranks related English text higher', async () => {
    const [q] = (await embed(['How do I get a refund?'], 'query')).vectors;
    const [rel, unrel] = (
      await embed([
        'Refund policy: you can return items within 30 days for a full refund.',
        'Our office is located in Berlin.',
      ])
    ).vectors;
    expect(cos(q ?? [], rel ?? [])).toBeGreaterThan(cos(q ?? [], unrel ?? []) + 0.05);
  });
});

describe('bge through Llm', () => {
  it('ignores the purpose', async () => {
    const llm = new Llm(new ProviderRegistry(config), localResolver, new SystemClock());
    const base = {
      workspaceId: ws,
      credentialId: cid,
      model: 'bge-small-en-v1.5',
      inputs: ['refund'],
      signal: new AbortController().signal,
    };
    const asQuery = await llm.embed({ ...base, purpose: 'query' });
    const asDocument = await llm.embed(base);
    expect(asQuery.vectors).toEqual(asDocument.vectors);
  });
});

/** Production runs CommonJS, which loads the library's CommonJS build and native binding. */
describe('local model under @swc-node/register (CommonJS)', () => {
  it('embeds through the registry', () => {
    const script = `
      const { loadConfig } = require('./src/common/config');
      const { ProviderRegistry } = require('./src/providers');
      const config = loadConfig({
        NODE_ENV: 'production',
        PUBLIC_URL: 'http://localhost:3000',
        DATABASE_URL: 'postgres://app:app@localhost:5432/app',
        AUTH_SECRET: 'a'.repeat(32),
        WIDGET_SECRET: 'w'.repeat(32),
        ENCRYPTION_KEYS: 'v1:' + 'ab'.repeat(32),
      });
      const model = new ProviderRegistry(config).embeddingModel(
        { id: 'c', workspaceId: 'w', provider: 'local', apiKey: null, baseUrl: null, updatedAt: new Date(0) },
        'bge-small-en-v1.5',
      );
      model.doEmbed({ values: ['hello'] }).then((r) => process.stdout.write(String(r.embeddings[0].length)));
    `;
    const r = spawnSync(process.execPath, ['-r', '@swc-node/register', '-e', script], {
      cwd: resolve(__dirname, '../../..'),
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('384');
    expect(r.status).toBe(0);
  }, 120_000);
});
