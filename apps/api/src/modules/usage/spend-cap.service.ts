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
}

/**
 * Spec §15.2: checked before each generation. Month-to-date comes from `usage_daily`, so the
 * cap follows exactly the buckets the usage page shows. No cap is always `ok`.
 */
@Injectable()
export class SpendCapService {
  constructor(private readonly usage: UsageRepository) {}

  async check(
    workspaceId: WorkspaceId,
    bot: Pick<BotEntity, 'id' | 'monthlySpendCapUsd'>,
    now: Date,
  ): Promise<SpendCapStatus> {
    const mtdUsd = await this.usage.monthToDateCost(workspaceId, bot.id, now);
    if (bot.monthlySpendCapUsd === null) {
      return { state: 'ok', mtdUsd, capUsd: null, ratio: null };
    }

    const ratio = new Big(mtdUsd).div(new Big(bot.monthlySpendCapUsd)).toNumber();
    const state = ratio >= 1 ? 'reached' : ratio >= SPEND_WARN_RATIO ? 'warn' : 'ok';
    return { state, mtdUsd, capUsd: bot.monthlySpendCapUsd, ratio };
  }
}
