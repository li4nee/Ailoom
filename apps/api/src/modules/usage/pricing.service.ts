// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import Big from 'big.js';

import type { ModelPriceDto, ProviderKind } from '@app/shared';
import { updateModelPricesSchema } from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { BUILTIN_PRICES } from '../../providers/model-catalog';
import { ModelPricesRepository } from './model-prices.repository';

/** Providers that run on the instance's own hardware: known, and free. */
const FREE_PROVIDERS: ReadonlySet<string> = new Set(['ollama', 'local', 'mock']);

const ZERO = new Big(0);
const PER_MILLION = new Big(1_000_000);

export interface ResolvedPrice {
  inputPerMtok: string;
  outputPerMtok: string;
  known: boolean;
}

export interface UsageToPrice {
  chat?: { provider: ProviderKind; model: string; inputTokens: number; outputTokens: number };
  embedding?: { provider: ProviderKind; model: string; tokens: number };
}

export interface CostedUsage {
  /** Six decimals, computed with big.js: `usage_daily.cost_usd` is `numeric(12,6)`. */
  costUsd: string;
  priceKnown: boolean;
}

type PriceIndex = Map<string, { input: Big; output: Big }>;

function keyOf(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/** Built-in prices as `numeric(10,4)` strings, so the API and the table agree on formatting. */
function builtinRow(provider: ProviderKind, model: string): ResolvedPrice | null {
  const row = BUILTIN_PRICES.prices[provider]?.[model];
  if (row === undefined) return null;
  return {
    inputPerMtok: new Big(row.input).toFixed(4),
    outputPerMtok: new Big(row.output).toFixed(4),
    known: true,
  };
}

/**
 * Spec §9.5: what a call costs. Resolution order is workspace override → shipped table →
 * free provider → unknown. An unknown model costs `0` and is flagged, so a trace never shows a
 * made-up figure and the UI can say "price unknown".
 */
@Injectable()
export class PricingService {
  constructor(private readonly prices: ModelPricesRepository) {}

  async price(
    workspaceId: WorkspaceId,
    provider: ProviderKind,
    model: string,
  ): Promise<ResolvedPrice> {
    return this.resolve(await this.index(workspaceId), provider, model);
  }

  /** The price of one generation, or of one embedding batch, rounded to 6 decimals. */
  async cost(workspaceId: WorkspaceId, usage: UsageToPrice): Promise<CostedUsage> {
    const index = await this.index(workspaceId);
    let total = ZERO;
    let known = true;

    if (usage.chat !== undefined) {
      const price = this.resolve(index, usage.chat.provider, usage.chat.model);
      if (!price.known) known = false;
      total = total
        .plus(new Big(usage.chat.inputTokens).times(price.inputPerMtok).div(PER_MILLION))
        .plus(new Big(usage.chat.outputTokens).times(price.outputPerMtok).div(PER_MILLION));
    }
    if (usage.embedding !== undefined) {
      const price = this.resolve(index, usage.embedding.provider, usage.embedding.model);
      if (!price.known) known = false;
      total = total.plus(
        new Big(usage.embedding.tokens).times(price.inputPerMtok).div(PER_MILLION),
      );
    }

    return { costUsd: total.toFixed(6), priceKnown: known };
  }

  /** Built-ins with the workspace's overrides layered on top (spec §9.5 admin table). */
  async listMerged(workspaceId: WorkspaceId): Promise<ModelPriceDto[]> {
    const overrides = await this.prices.listOverrides(workspaceId);
    const shadowed = new Set(overrides.map((row) => keyOf(row.provider, row.model)));

    const rows: ModelPriceDto[] = [];
    for (const [provider, models] of Object.entries(BUILTIN_PRICES.prices)) {
      for (const [model, price] of Object.entries(models)) {
        if (shadowed.has(keyOf(provider, model))) continue;
        rows.push({
          provider: provider as ProviderKind,
          model,
          inputPerMtokUsd: new Big(price.input).toFixed(4),
          outputPerMtokUsd: new Big(price.output).toFixed(4),
          source: 'builtin',
        });
      }
    }
    for (const row of overrides) {
      rows.push({
        provider: row.provider as ProviderKind,
        model: row.model,
        inputPerMtokUsd: row.inputPerMtokUsd,
        outputPerMtokUsd: row.outputPerMtokUsd,
        source: 'override',
      });
    }
    return rows.sort((a, b) =>
      keyOf(a.provider, a.model).localeCompare(keyOf(b.provider, b.model)),
    );
  }

  /** `PUT …/model-prices`: replace the workspace's overrides with exactly this list. */
  async replaceOverrides(workspaceId: WorkspaceId, input: unknown): Promise<ModelPriceDto[]> {
    const parsed = updateModelPricesSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('validation_failed', {
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
    // A self-hosted model has no per-token cost by definition, and an override is the one thing
    // that could bill it: reject rather than store a row `resolve` would ignore.
    const free = parsed.data.prices.findIndex((price) => FREE_PROVIDERS.has(price.provider));
    if (free !== -1) {
      throw new AppError('validation_failed', {
        details: [
          {
            path: `prices.${String(free)}.provider`,
            message: 'Self-hosted providers run on your own hardware and are always free.',
          },
        ],
      });
    }
    await this.prices.replaceOverrides(workspaceId, parsed.data.prices);
    return this.listMerged(workspaceId);
  }

  private resolve(index: PriceIndex, provider: ProviderKind, model: string): ResolvedPrice {
    const override = index.get(keyOf(provider, model));
    if (override !== undefined) {
      return {
        inputPerMtok: override.input.toFixed(4),
        outputPerMtok: override.output.toFixed(4),
        known: true,
      };
    }
    // Free before the table: a provider with no price list to speak of is free for any model.
    // `replaceOverrides` rejects overrides for these, so no stored row can shadow this.
    if (FREE_PROVIDERS.has(provider)) {
      return { inputPerMtok: '0.0000', outputPerMtok: '0.0000', known: true };
    }
    return (
      builtinRow(provider, model) ?? {
        inputPerMtok: '0.0000',
        outputPerMtok: '0.0000',
        known: false,
      }
    );
  }

  private async index(workspaceId: WorkspaceId): Promise<PriceIndex> {
    const rows = await this.prices.listOverrides(workspaceId);
    return new Map(
      rows.map((row) => [
        keyOf(row.provider, row.model),
        { input: new Big(row.inputPerMtokUsd), output: new Big(row.outputPerMtokUsd) },
      ]),
    );
  }
}
