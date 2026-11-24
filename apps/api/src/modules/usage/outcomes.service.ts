// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import Big from 'big.js';

import type { OutcomeDay, OutcomesDto, OutcomesQuery } from '@app/shared';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { OutcomesRepository } from './outcomes.repository';

function asNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function emptyDay(day: string): OutcomeDay {
  return { day, conversations: 0, aiResolved: 0, handedOff: 0 };
}

/** Applies bounded UTC dates and fills the full daily series for the outcomes report. */
@Injectable()
export class OutcomesService {
  constructor(
    private readonly outcomes: OutcomesRepository,
    private readonly clock: Clock,
  ) {}

  async compute(workspaceId: WorkspaceId, query: OutcomesQuery): Promise<OutcomesDto> {
    if (query.botId !== undefined && !(await this.outcomes.assertBot(workspaceId, query.botId))) {
      throw new AppError('not_found');
    }

    const from = new Date(`${query.from}T00:00:00.000Z`);
    const endDay = new Date(`${query.to}T00:00:00.000Z`);
    const toExclusive = new Date(endDay.getTime() + 86_400_000);
    const now = this.clock.now();
    const { summary, daily: rows } = await this.outcomes.compute(
      workspaceId,
      from,
      toExclusive,
      query.botId,
      now,
    );
    const byDay = new Map(
      rows.map((row) => [
        row.day,
        {
          day: row.day,
          conversations: row.conversations,
          aiResolved: row.aiResolved,
          handedOff: row.handedOff,
        } satisfies OutcomeDay,
      ]),
    );
    const daily: OutcomeDay[] = [];
    for (
      let cursor = from;
      cursor < toExclusive;
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      const day = cursor.toISOString().slice(0, 10);
      daily.push(byDay.get(day) ?? emptyDay(day));
    }

    return {
      conversations: summary.conversations,
      pending: summary.pending,
      handoffRate: asNumber(summary.handoffRate),
      aiResolutionRate: asNumber(summary.aiResolutionRate),
      aiResolved: summary.aiResolved,
      handedOff: summary.handedOff,
      firstHumanResponse: {
        medianSeconds: asNumber(summary.firstHumanMedianSeconds),
        p90Seconds: asNumber(summary.firstHumanP90Seconds),
        unanswered: summary.firstHumanUnanswered,
      },
      resolutionTime: {
        medianSeconds: asNumber(summary.resolutionMedianSeconds),
        p90Seconds: asNumber(summary.resolutionP90Seconds),
      },
      csat: {
        satisfiedRate: asNumber(summary.csatSatisfiedRate),
        averageScore: asNumber(summary.csatAverageScore),
        responseRate: asNumber(summary.csatResponseRate),
        ratings: summary.csatRatings,
      },
      costPerResolvedUsd:
        summary.costResolvedCount === 0
          ? null
          : new Big(summary.totalCostUsd).div(summary.costResolvedCount).toFixed(6),
      daily,
    };
  }
}
