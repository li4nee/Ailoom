// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import Big from 'big.js';

import type { WorkspaceId } from '../../db/ids';
import type { BotEntity } from '../bots';
import { UsageRepository } from './usage.repository';

/** At this share of the cap the owners get a warning email (spec §15.2). */
export const SPEND_WARN_RATIO = 0.8;

export interface SpendCapStatus {
  state: 'ok' | 'warn' | 'reached';
  /** Month-to-date cost, six decimals. */
  mtdUsd: string;
  capUsd: string | null;
  ratio: number | null;
  reachedCap?: 'daily' | 'monthly' | undefined;
}

/**
 * Spec §15.2: checked before each generation. Month-to-date comes from `usage_daily`, so the
 * caps follow exactly the buckets the usage page shows. No cap is always `ok`.
 */
@Injectable()
export class SpendCapService {
  constructor(private readonly usage: UsageRepository) {}

  async check(
    workspaceId: WorkspaceId,
    bot: Pick<BotEntity, 'id' | 'monthlySpendCapUsd'> &
      Partial<Pick<BotEntity, 'dailySpendCapUsd'>>,
    now: Date,
  ): Promise<SpendCapStatus> {
    const [mtdUsd, dailyUsd] = await Promise.all([
      this.usage.monthToDateCost(workspaceId, bot.id, now),
      bot.dailySpendCapUsd === null || bot.dailySpendCapUsd === undefined
        ? Promise.resolve('0.000000')
        : this.usage.dailyCost(workspaceId, bot.id, now),
    ]);
    const dailyReached = reached(dailyUsd, bot.dailySpendCapUsd ?? null);
    const monthlyReached = reached(mtdUsd, bot.monthlySpendCapUsd);
    const reachedCap = dailyReached ? 'daily' : monthlyReached ? 'monthly' : null;
    const ratios = [
      ratio(dailyUsd, bot.dailySpendCapUsd ?? null),
      ratio(mtdUsd, bot.monthlySpendCapUsd),
    ].filter((value): value is number => value !== null);
    const highestRatio = ratios.length === 0 ? null : Math.max(...ratios);
    return {
      state:
        reachedCap !== null ? 'reached' : (highestRatio ?? 0) >= SPEND_WARN_RATIO ? 'warn' : 'ok',
      mtdUsd,
      capUsd: bot.monthlySpendCapUsd,
      ratio: ratio(mtdUsd, bot.monthlySpendCapUsd),
      ...(dailyReached ? { reachedCap: 'daily' as const } : {}),
    };
  }
}

function reached(spendUsd: string, capUsd: string | null): boolean {
  return capUsd !== null && new Big(capUsd).lte(0)
    ? true
    : capUsd !== null && new Big(spendUsd).gte(capUsd);
}

function ratio(spendUsd: string, capUsd: string | null): number | null {
  if (capUsd === null || new Big(capUsd).lte(0)) return null;
  return new Big(spendUsd).div(capUsd).toNumber();
}
