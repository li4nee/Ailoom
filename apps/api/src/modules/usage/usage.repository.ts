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

  /** The counters a copy of the row holds, for tests and dashboards. */
  async get(key: UsageKey): Promise<Record<string, string | number> | null> {
    const rows = await this.ds.query<Record<string, string | number>[]>(
      `SELECT * FROM usage_daily WHERE workspace_id = $1 AND bot_id = $2 AND day = $3`,
      [key.workspaceId, key.botId, key.day],
    );
    return rows[0] ?? null;
  }
}
