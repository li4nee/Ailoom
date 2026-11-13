// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';

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

  /** The counters a copy of the row holds, for tests and dashboards. */
  async get(key: UsageKey): Promise<Record<string, string | number> | null> {
    const rows = await this.ds.query<Record<string, string | number>[]>(
      `SELECT * FROM usage_daily WHERE workspace_id = $1 AND bot_id = $2 AND day = $3`,
      [key.workspaceId, key.botId, key.day],
    );
    return rows[0] ?? null;
  }
}
