// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';

export interface OutcomeSummaryRow {
  conversations: number;
  pending: number;
  aiResolved: number;
  handedOff: number;
  handoffRate: number | string | null;
  aiResolutionRate: number | string | null;
  firstHumanMedianSeconds: number | string | null;
  firstHumanP90Seconds: number | string | null;
  firstHumanUnanswered: number;
  resolutionMedianSeconds: number | string | null;
  resolutionP90Seconds: number | string | null;
  csatSatisfiedRate: number | string | null;
  csatAverageScore: number | string | null;
  csatResponseRate: number | string | null;
  csatRatings: number;
  totalCostUsd: string;
  costResolvedCount: number;
}

export interface OutcomeDayRow {
  day: string;
  conversations: number;
  aiResolved: number;
  handedOff: number;
}

export interface OutcomesQueryRow {
  summary: OutcomeSummaryRow;
  daily: OutcomeDayRow[];
}

const POPULATION_CTE = `
  WITH population AS (
    SELECT c.id, c.created_at, c.status, c.handoff_requested_at, c.closed_at,
           c.last_message_at, c.csat_score,
           c.outcome_has_complete_ai_answer AS has_complete_ai,
           c.outcome_has_ai_downvote AS has_ai_downvote,
           c.outcome_first_agent_reply_at AS first_agent_at,
           c.outcome_trace_cost_usd AS cost_usd
      FROM conversations c
     WHERE c.workspace_id = $1
       AND c.created_at >= $2 AND c.created_at < $3
       AND ($4::uuid IS NULL OR c.bot_id = $4)
       AND c.outcome_has_visitor_message
  ), outcomes AS (
    SELECT population.*,
           (handoff_requested_at IS NULL AND has_complete_ai AND NOT has_ai_downvote
             AND (status = 'closed' OR last_message_at < $5::timestamptz - interval '24 hours'))
             AS is_ai_resolved
      FROM population
  )`;

/** Exact report queries stay in SQL so aggregates and percentiles run close to indexed data. */
@Injectable()
export class OutcomesRepository {
  constructor(private readonly ds: DataSource) {}

  async assertBot(workspaceId: WorkspaceId, botId: string): Promise<boolean> {
    const rows = await this.ds.query<{ present: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM bots WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
       ) AS present`,
      [workspaceId, botId],
    );
    return rows[0]?.present ?? false;
  }

  async compute(
    workspaceId: WorkspaceId,
    from: Date,
    toExclusive: Date,
    botId: string | undefined,
    now: Date,
  ): Promise<OutcomesQueryRow> {
    // One statement shares the classified population and workspace-scoped facts between the
    // summary and daily series. Separate report queries scanned the same messages twice and
    // missed the 300 ms p95 target at 50k conversations.
    const sql = `${POPULATION_CTE}, summary AS (
       SELECT count(*)::int AS conversations,
              count(*) FILTER (WHERE handoff_requested_at IS NULL AND status <> 'closed'
                AND last_message_at >= $5::timestamptz - interval '24 hours')::int AS pending,
              count(*) FILTER (WHERE is_ai_resolved)::int AS "aiResolved",
              count(*) FILTER (WHERE handoff_requested_at IS NOT NULL)::int AS "handedOff",
              count(*) FILTER (WHERE handoff_requested_at IS NOT NULL)::float8
                / nullif(count(*), 0) AS "handoffRate",
              count(*) FILTER (WHERE is_ai_resolved)::float8
                / nullif(count(*) FILTER (WHERE is_ai_resolved OR handoff_requested_at IS NOT NULL), 0)
                AS "aiResolutionRate",
              percentile_cont(0.5) WITHIN GROUP
                (ORDER BY extract(epoch FROM (first_agent_at - handoff_requested_at)))
                FILTER (WHERE handoff_requested_at IS NOT NULL AND first_agent_at IS NOT NULL)
                AS "firstHumanMedianSeconds",
              percentile_cont(0.9) WITHIN GROUP
                (ORDER BY extract(epoch FROM (first_agent_at - handoff_requested_at)))
                FILTER (WHERE handoff_requested_at IS NOT NULL AND first_agent_at IS NOT NULL)
                AS "firstHumanP90Seconds",
              count(*) FILTER (WHERE handoff_requested_at IS NOT NULL AND first_agent_at IS NULL)::int
                AS "firstHumanUnanswered",
              percentile_cont(0.5) WITHIN GROUP
                (ORDER BY extract(epoch FROM (closed_at - handoff_requested_at)))
                FILTER (WHERE handoff_requested_at IS NOT NULL AND status = 'closed'
                  AND closed_at IS NOT NULL) AS "resolutionMedianSeconds",
              percentile_cont(0.9) WITHIN GROUP
                (ORDER BY extract(epoch FROM (closed_at - handoff_requested_at)))
                FILTER (WHERE handoff_requested_at IS NOT NULL AND status = 'closed'
                  AND closed_at IS NOT NULL) AS "resolutionP90Seconds",
              count(*) FILTER (WHERE csat_score >= 4)::float8 / nullif(count(csat_score), 0)
                AS "csatSatisfiedRate",
              avg(csat_score) AS "csatAverageScore",
              count(csat_score)::float8 / nullif(count(*) FILTER (WHERE status = 'closed'), 0)
                AS "csatResponseRate",
              count(csat_score)::int AS "csatRatings",
              coalesce(sum(cost_usd), 0)::numeric(18,6)::text AS "totalCostUsd",
              (count(*) FILTER (WHERE is_ai_resolved)
                + count(*) FILTER (WHERE handoff_requested_at IS NOT NULL AND status = 'closed'))::int
                AS "costResolvedCount"
         FROM outcomes
      ), daily AS (
       SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              count(*)::int AS conversations,
              count(*) FILTER (WHERE is_ai_resolved)::int AS "aiResolved",
              count(*) FILTER (WHERE handoff_requested_at IS NOT NULL)::int AS "handedOff"
         FROM outcomes
        GROUP BY 1
      )
       SELECT jsonb_build_object(
                'summary', (SELECT to_jsonb(summary) FROM summary),
                'daily', coalesce((SELECT jsonb_agg(to_jsonb(daily) ORDER BY daily.day) FROM daily), '[]'::jsonb)
              ) AS report`;
    const parameters = [workspaceId, from, toExclusive, botId ?? null, now];
    const rows = await this.ds.query<{ report: OutcomesQueryRow }[]>(sql, parameters);
    const report = rows[0]?.report;
    if (report === undefined) throw new Error('outcomes query returned no row');
    return report;
  }
}
