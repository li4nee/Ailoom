// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { utcDay, utcMonthStart } from './utc';

export interface UsageKey {
  workspaceId: WorkspaceId;
  botId: string;
  /** UTC day, `YYYY-MM-DD`. */
  day: string;
}

export interface UsageDeltas {
  conversations?: number;
  visitorMessages?: number;
  aiMessages?: number;
  escalations?: number;
  inputTokens?: number;
  outputTokens?: number;
  embeddingTokens?: number;
  /** A six-decimal string: the column is `numeric`, never a float. */
  costUsd?: string;
}

interface Column {
  name: string;
  value: string | number;
}

/** One aggregated UTC day from `usage_daily`; bigint and numeric arrive as strings. */
export interface UsageDayRow {
  day: string;
  conversations: number;
  visitor_messages: number;
  ai_messages: number;
  escalations: number;
  input_tokens: string;
  output_tokens: string;
  embedding_tokens: string;
  cost_usd: string;
}

export interface FeedbackCountsRow {
  positive: number;
  negative: number;
}

export interface MonthToDateRow {
  cost_usd: string;
  cap_usd: string | null;
}

/**
 * The day's counters for one bot (spec §9.5). Raw SQL because a rollup write is a read-modify-
 * write that must be atomic across concurrent jobs: `INSERT … ON CONFLICT DO UPDATE` adds the
 * delta in the database instead of read-then-write in the application. Always takes the
 * caller's manager, so the counters commit with the work they describe.
 */
@Injectable()
export class UsageRepository {
  constructor(private readonly ds: DataSource) {}

  async increment(manager: EntityManager, key: UsageKey, deltas: UsageDeltas): Promise<void> {
    const columns: Column[] = [];
    const add = (name: string, value: number | string | undefined): void => {
      if (value !== undefined) columns.push({ name, value });
    };
    add('conversations', deltas.conversations);
    add('visitor_messages', deltas.visitorMessages);
    add('ai_messages', deltas.aiMessages);
    add('escalations', deltas.escalations);
    add('input_tokens', deltas.inputTokens);
    add('output_tokens', deltas.outputTokens);
    add('embedding_tokens', deltas.embeddingTokens);
    add('cost_usd', deltas.costUsd);
    if (columns.length === 0) return;

    const names = columns.map((column) => `"${column.name}"`).join(', ');
    const holes = columns.map((_, index) => `$${String(index + 4)}`).join(', ');
    const updates = columns
      .map(
        (column) => `"${column.name}" = usage_daily."${column.name}" + EXCLUDED."${column.name}"`,
      )
      .join(', ');
    await manager.query(
      `INSERT INTO usage_daily (workspace_id, bot_id, day, ${names})
       VALUES ($1, $2, $3, ${holes})
       ON CONFLICT (workspace_id, bot_id, day) DO UPDATE SET ${updates}`,
      [key.workspaceId, key.botId, key.day, ...columns.map((column) => column.value)],
    );
  }

  /**
   * Spend-cap input: everything spent this UTC month through `now`'s UTC day (spec §15.2).
   * Raw SQL because `usage_daily` holds daily rows: the sum is the database's job, and the
   * month boundary is applied in UTC, not by the server's zone.
   */
  async monthToDateCost(workspaceId: WorkspaceId, botId: string, now: Date): Promise<string> {
    const rows = await this.ds.query<{ cost: string }[]>(
      `SELECT coalesce(sum(cost_usd), 0)::numeric(12,6)::text AS cost
         FROM usage_daily
        WHERE workspace_id = $1 AND bot_id = $2 AND day >= $3 AND day <= $4`,
      [workspaceId, botId, utcMonthStart(now), utcDay(now)],
    );
    return rows[0]?.cost ?? '0.000000';
  }

  /** Everything spent in one UTC month, for a spend alert (spec §15.2). */
  async monthCost(workspaceId: WorkspaceId, botId: string, month: string): Promise<string> {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const rows = await this.ds.query<{ cost: string }[]>(
      `SELECT coalesce(sum(cost_usd), 0)::numeric(12,6)::text AS cost
         FROM usage_daily
        WHERE workspace_id = $1 AND bot_id = $2 AND day >= $3 AND day < $4`,
      [workspaceId, botId, start.toISOString().slice(0, 10), next.toISOString().slice(0, 10)],
    );
    return rows[0]?.cost ?? '0.000000';
  }

  /**
   * The five contacts that cost the bot the most this month, for the spend alert (spec §10.4).
   * Grouped by contact; `contact.email` falls back to the id, because visitor IPs are never
   * stored. Raw SQL because the rollup lives in traces and conversations, not `usage_daily`.
   */
  async topContactsByCost(
    workspaceId: WorkspaceId,
    botId: string,
    month: string,
    limit = 5,
  ): Promise<{ contact: string; conversations: number; costUsd: string }[]> {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return this.ds.query<{ contact: string; conversations: number; costUsd: string }[]>(
      `SELECT coalesce(c.email, c.id::text) AS contact,
              count(DISTINCT t.conversation_id)::int AS conversations,
              sum(t.cost_usd)::numeric(12,6)::text AS "costUsd"
         FROM generation_traces t
         JOIN conversations conv ON conv.id = t.conversation_id
         JOIN contacts c ON c.id = conv.contact_id
        WHERE t.workspace_id = $1
          AND t.bot_id = $2
          AND t.conversation_id IS NOT NULL
          AND t.created_at >= $3
          AND t.created_at < $4
        GROUP BY c.email, c.id
        ORDER BY sum(t.cost_usd) DESC, contact ASC
        LIMIT $5`,
      [workspaceId, botId, start, next, limit],
    );
  }

  /**
   * Who gets a spend alert: the workspace's notification addresses, else every owner and admin
   * (spec §15.2). Raw SQL because the setting is jsonb and the fallback joins memberships.
   */
  async alertRecipients(workspaceId: WorkspaceId): Promise<string[]> {
    const rows = await this.ds.query<{ address: string }[]>(
      `WITH configured AS (
         SELECT jsonb_array_elements_text(
                  coalesce(w.settings->'notificationEmails', '[]'::jsonb)
                ) AS address
           FROM workspaces w
          WHERE w.id = $1 AND w.deleted_at IS NULL
       )
       SELECT address FROM configured
       UNION
       SELECT u.email AS address
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1
          AND m.role IN ('owner', 'admin')
          AND NOT EXISTS (SELECT 1 FROM configured)`,
      [workspaceId],
    );
    return [...new Set(rows.map((row) => row.address))];
  }

  /** Daily totals for the reports page, cross-bot unless `botId` is set. */
  async daily(
    workspaceId: WorkspaceId,
    from: string,
    to: string,
    botId?: string,
  ): Promise<UsageDayRow[]> {
    return this.ds.query<UsageDayRow[]>(
      `SELECT day::text AS day,
              sum(conversations)::int AS conversations,
              sum(visitor_messages)::int AS visitor_messages,
              sum(ai_messages)::int AS ai_messages,
              sum(escalations)::int AS escalations,
              sum(input_tokens)::text AS input_tokens,
              sum(output_tokens)::text AS output_tokens,
              sum(embedding_tokens)::text AS embedding_tokens,
              sum(cost_usd)::numeric(12,6)::text AS cost_usd
         FROM usage_daily
        WHERE workspace_id = $1 AND day >= $2 AND day <= $3
          AND ($4::uuid IS NULL OR bot_id = $4)
        GROUP BY day
        ORDER BY day`,
      [workspaceId, from, to, botId ?? null],
    );
  }

  /** Positive and negative thumbs on AI answers, optionally for one bot. */
  async feedbackCounts(workspaceId: WorkspaceId, botId?: string): Promise<FeedbackCountsRow> {
    const rows = await this.ds.query<FeedbackCountsRow[]>(
      `SELECT count(*) FILTER (WHERE m.feedback = 1)::int AS positive,
              count(*) FILTER (WHERE m.feedback = -1)::int AS negative
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.workspace_id = $1 AND m.role = 'ai' AND m.feedback IN (1, -1)
          AND ($2::uuid IS NULL OR c.bot_id = $2)`,
      [workspaceId, botId ?? null],
    );
    return rows[0] ?? { positive: 0, negative: 0 };
  }

  /** Month-to-date cost and the summed cap of the selected (or all) live bots. */
  async monthToDate(
    workspaceId: WorkspaceId,
    botId: string | undefined,
    now: Date,
  ): Promise<MonthToDateRow> {
    const rows = await this.ds.query<MonthToDateRow[]>(
      `SELECT coalesce((
                SELECT sum(cost_usd)
                  FROM usage_daily
                 WHERE workspace_id = $1 AND day >= $2 AND day <= $3
                   AND ($4::uuid IS NULL OR bot_id = $4)
              ), 0)::numeric(12,6)::text AS cost_usd,
              (
                SELECT sum(monthly_spend_cap_usd)::numeric(12,6)::text
                  FROM bots
                 WHERE workspace_id = $1 AND deleted_at IS NULL
                   AND ($4::uuid IS NULL OR id = $4)
              ) AS cap_usd`,
      [workspaceId, utcMonthStart(now), utcDay(now), botId ?? null],
    );
    return rows[0] ?? { cost_usd: '0.000000', cap_usd: null };
  }

  /** The counters a copy of the row holds, for tests and dashboards. */
  async get(key: UsageKey): Promise<Record<string, string | number> | null> {
    const rows = await this.ds.query<Record<string, string | number>[]>(
      `SELECT * FROM usage_daily WHERE workspace_id = $1 AND bot_id = $2 AND day = $3`,
      [key.workspaceId, key.botId, key.day],
    );
    return rows[0] ?? null;
  }
}
