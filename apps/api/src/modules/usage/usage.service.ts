// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import Big from 'big.js';

import type { UsageDay, UsageQuery, UsageReport } from '@app/shared';

import { Clock } from '../../common/clock';
import type { WorkspaceId } from '../../db/ids';
import { UsageRepository } from './usage.repository';

const ZERO = new Big(0);

function emptyDay(day: string): UsageDay {
  return {
    day,
    conversations: 0,
    visitorMessages: 0,
    aiMessages: 0,
    escalations: 0,
    inputTokens: 0,
    outputTokens: 0,
    embeddingTokens: 0,
    costUsd: '0.000000',
  };
}

/** The usage report of spec §17.10: every requested UTC day appears, zeros included. */
@Injectable()
export class UsageService {
  constructor(
    private readonly usage: UsageRepository,
    private readonly clock: Clock,
  ) {}

  async report(workspaceId: WorkspaceId, query: UsageQuery): Promise<UsageReport> {
    const rows = await this.usage.daily(workspaceId, query.from, query.to, query.botId);
    const byDay = new Map(
      rows.map((row) => [
        row.day,
        {
          day: row.day,
          conversations: row.conversations,
          visitorMessages: row.visitor_messages,
          aiMessages: row.ai_messages,
          escalations: row.escalations,
          inputTokens: Number(row.input_tokens),
          outputTokens: Number(row.output_tokens),
          embeddingTokens: Number(row.embedding_tokens),
          costUsd: row.cost_usd,
        } satisfies UsageDay,
      ]),
    );

    const days: UsageDay[] = [];
    const start = new Date(`${query.from}T00:00:00.000Z`);
    const end = new Date(`${query.to}T00:00:00.000Z`);
    for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
      const day = cursor.toISOString().slice(0, 10);
      days.push(byDay.get(day) ?? emptyDay(day));
    }

    const totals = {
      conversations: 0,
      visitorMessages: 0,
      aiMessages: 0,
      escalations: 0,
      inputTokens: 0,
      outputTokens: 0,
      embeddingTokens: 0,
      costUsd: ZERO,
    };
    for (const day of days) {
      totals.conversations += day.conversations;
      totals.visitorMessages += day.visitorMessages;
      totals.aiMessages += day.aiMessages;
      totals.escalations += day.escalations;
      totals.inputTokens += day.inputTokens;
      totals.outputTokens += day.outputTokens;
      totals.embeddingTokens += day.embeddingTokens;
      totals.costUsd = totals.costUsd.plus(new Big(day.costUsd));
    }

    const feedback = await this.usage.feedbackCounts(workspaceId, query.botId);
    const rated = feedback.positive + feedback.negative;
    const mtd = await this.usage.monthToDate(workspaceId, query.botId, this.clock.now());

    return {
      days,
      totals: { ...totals, costUsd: totals.costUsd.toFixed(6) },
      feedback: {
        positive: feedback.positive,
        negative: feedback.negative,
        positiveRate: rated === 0 ? null : feedback.positive / rated,
      },
      monthToDate: mtd.cap_usd === null ? null : { costUsd: mtd.cost_usd, capUsd: mtd.cap_usd },
    };
  }
}
