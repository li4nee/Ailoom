// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser, createWorkspace } from '../../../test/helpers/factories';
import { ConfigModule, loadConfig } from '../../common/config';
import { DatabaseModule } from '../../db';
import { asWorkspaceId, type WorkspaceId } from '../../db/ids';
import { modelsFileSchema, pricesFileSchema } from '../../providers/model-catalog';
import { PricingService } from './pricing.service';
import { UsageModule } from './usage.module';

function config() {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://support.example.com',
    DATABASE_URL: inject('databaseUrl'),
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
  });
}

let ds: DataSource;
let module_: Awaited<ReturnType<typeof buildModule>>;
let pricing: PricingService;

let ws: WorkspaceId;
let otherWs: WorkspaceId;

async function buildModule(dataSource: DataSource) {
  const cfg = config();
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot(cfg),
      DatabaseModule.forRoot(cfg, dataSource),
      ClsModule.forRoot({ global: true }),
      UsageModule,
    ],
  }).compile();
}

beforeAll(async () => {
  ds = await getTestDataSource();
  module_ = await buildModule(ds);
  await module_.init();
  pricing = module_.get(PricingService);
});

afterAll(async () => {
  await module_.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
  const { user: owner } = await createUser({ ds }, { email: 'owner@example.com' });
  const { user: stranger } = await createUser({ ds }, { email: 'stranger@example.com' });
  ws = asWorkspaceId((await createWorkspace({ ds }, owner, 'Acme')).id);
  otherWs = asWorkspaceId((await createWorkspace({ ds }, stranger, 'Globex')).id);
});

function readData(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, '..', '..', 'providers', 'data', name), 'utf8'));
}

describe('PricingService', () => {
  it('computes exact cost', async () => {
    const cost = await pricing.cost(ws, {
      chat: { provider: 'openai', model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 },
    });

    expect(cost).toEqual({ costUsd: '0.000450', priceKnown: true });
  });

  it('prices auxiliary chat calls using their own provider and model', async () => {
    const cost = await pricing.cost(ws, {
      chat: { provider: 'openai', model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 },
      additionalChats: [
        {
          provider: 'groq',
          model: 'llama-3.1-8b-instant',
          inputTokens: 1000,
          outputTokens: 500,
        },
      ],
    });

    expect(cost).toEqual({ costUsd: '0.000540', priceKnown: true });
  });

  it('prices embeddings by input tokens only', async () => {
    const cost = await pricing.cost(ws, {
      embedding: { provider: 'openai', model: 'text-embedding-3-small', tokens: 2000 },
    });

    expect(cost).toEqual({ costUsd: '0.000040', priceKnown: true });
  });

  it('workspace overrides win', async () => {
    await pricing.replaceOverrides(ws, {
      prices: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputPerMtokUsd: '1.0000',
          outputPerMtokUsd: '2.0000',
        },
      ],
    });

    expect(await pricing.price(ws, 'openai', 'gpt-4o-mini')).toMatchObject({
      inputPerMtok: '1.0000',
      outputPerMtok: '2.0000',
      known: true,
    });
    expect(
      await pricing.cost(ws, {
        chat: { provider: 'openai', model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 },
      }),
    ).toEqual({ costUsd: '0.002000', priceKnown: true });
    // The other workspace still see the built-in table.
    expect(await pricing.price(otherWs, 'openai', 'gpt-4o-mini')).toMatchObject({
      inputPerMtok: '0.1500',
    });
  });

  it('unknown models cost 0 and are flagged', async () => {
    expect(
      await pricing.cost(ws, {
        chat: { provider: 'openai_compatible', model: 'my-llm', inputTokens: 10, outputTokens: 10 },
      }),
    ).toEqual({ costUsd: '0.000000', priceKnown: false });
  });

  it('ollama is free and known', async () => {
    expect(
      await pricing.cost(ws, {
        chat: { provider: 'ollama', model: 'llama3.2', inputTokens: 10_000, outputTokens: 5_000 },
      }),
    ).toEqual({ costUsd: '0.000000', priceKnown: true });
  });

  it('refuses to price a self-hosted provider', async () => {
    await expect(
      pricing.replaceOverrides(ws, {
        prices: [
          {
            provider: 'ollama',
            model: 'llama3.2',
            inputPerMtokUsd: '1.0000',
            outputPerMtokUsd: '2.0000',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const rows = await pricing.listMerged(ws);
    expect(rows.some((row) => row.source === 'override')).toBe(false);
  });

  it('rejects a provider typo in the shipped tables', () => {
    expect(() =>
      pricesFileSchema.parse({
        asOf: '2026-01-01',
        prices: { openaai: { 'gpt-4o': { input: 1, output: 2 } } },
      }),
    ).toThrow(/not a provider kind/);
    expect(() =>
      modelsFileSchema.parse({
        embedding: { 'unknown:model': { dimensions: 8, threshold: null } },
        chat: {},
      }),
    ).toThrow(/unknown:model|known provider/);
  });

  it('merges built-ins with overrides and flags each source', async () => {
    await pricing.replaceOverrides(ws, {
      prices: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputPerMtokUsd: '9.0000',
          outputPerMtokUsd: '9.0000',
        },
        {
          provider: 'openai_compatible',
          model: 'my-llm',
          inputPerMtokUsd: '0.1000',
          outputPerMtokUsd: '0.2000',
        },
      ],
    });

    const merged = await pricing.listMerged(ws);
    const mini = merged.filter((row) => row.provider === 'openai' && row.model === 'gpt-4o-mini');
    expect(mini).toEqual([
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        inputPerMtokUsd: '9.0000',
        outputPerMtokUsd: '9.0000',
        source: 'override',
      },
    ]);
    expect(merged).toContainEqual({
      provider: 'openai_compatible',
      model: 'my-llm',
      inputPerMtokUsd: '0.1000',
      outputPerMtokUsd: '0.2000',
      source: 'override',
    });
    expect(merged).toContainEqual(
      expect.objectContaining({ provider: 'openai', model: 'gpt-4o', source: 'builtin' }),
    );
    expect((await pricing.listMerged(ws)).length).toBe(
      (await pricing.listMerged(otherWs)).length + 1,
    );
  });

  it('replaces overrides instead of appending them', async () => {
    const first = {
      prices: [
        {
          provider: 'openai' as const,
          model: 'gpt-4o',
          inputPerMtokUsd: '1.0000',
          outputPerMtokUsd: '1.0000',
        },
      ],
    };
    await pricing.replaceOverrides(ws, first);
    await pricing.replaceOverrides(ws, first);
    await pricing.replaceOverrides(ws, { prices: [] });

    return Promise.all([
      expect(pricing.listMerged(ws)).resolves.not.toContainEqual(
        expect.objectContaining({ source: 'override', model: 'gpt-4o' }),
      ),
      expect(
        pricing.listMerged(otherWs).then((rows) => rows.every((row) => row.source === 'builtin')),
      ).resolves.toBe(true),
    ]);
  });

  it('prices.json and models.json validate against their schemas', () => {
    expect(() => modelsFileSchema.parse(readData('models.json'))).not.toThrow();
    expect(() => pricesFileSchema.parse(readData('prices.json'))).not.toThrow();

    const prices = pricesFileSchema.parse(readData('prices.json'));
    expect(prices.prices['openai']?.['gpt-4o-mini']).toEqual({ input: 0.15, output: 0.6 });
  });
});
