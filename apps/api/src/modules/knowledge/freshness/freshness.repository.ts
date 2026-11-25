// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { WorkspaceId } from '../../../db/ids';

export interface DueKnowledgeSource {
  workspaceId: WorkspaceId;
  sourceId: string;
}

/** Cross-tenant maintenance queries for the worker's scheduled freshness jobs. */
@Injectable()
export class FreshnessRepository {
  constructor(private readonly ds: DataSource) {}

  /**
   * Claims a bounded batch of ready URL and sitemap sources. The row locks prevent two worker
   * processes from claiming the same source in one tick; the caller rechecks status atomically
   * before enqueuing, so a concurrent delete or manual resync wins.
   */
  async claimDueSources(now: Date, limit: number): Promise<DueKnowledgeSource[]> {
    return this.ds.transaction(async (manager) => {
      const rows = await manager.query<{ workspace_id: WorkspaceId; id: string }[]>(
        `SELECT workspace_id, id
           FROM knowledge_sources
          WHERE status = 'ready' AND recrawl_interval IS NOT NULL
            AND type IN ('url', 'sitemap')
            AND COALESCE(last_synced_at, created_at) + recrawl_interval <= $1
          ORDER BY COALESCE(last_synced_at, created_at), id
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [now, limit],
      );
      return rows.map((row) => ({ workspaceId: row.workspace_id, sourceId: row.id }));
    });
  }

  /** Cursor page of stale or unreachable documents for one workspace. */
  async listStaleDocuments(input: {
    workspaceId: WorkspaceId;
    botId?: string;
    days: number;
    cursor?: string;
    limit: number;
  }): Promise<{
    data: {
      documentId: string;
      sourceId: string;
      botId: string;
      title: string | null;
      url: string | null;
      status: string;
      lastCheckedAt: Date | null;
      lastChangedAt: Date | null;
      unreachableSince: Date | null;
    }[];
    hasMore: boolean;
  }> {
    const rows = await this.ds.query<
      {
        document_id: string;
        source_id: string;
        bot_id: string;
        title: string | null;
        url: string | null;
        status: string;
        last_checked_at: Date | null;
        last_changed_at: Date | null;
        unreachable_since: Date | null;
      }[]
    >(
      `SELECT d.id AS document_id, d.source_id, d.bot_id, d.title, d.url, d.status,
              d.last_checked_at, v.created_at AS last_changed_at, d.unreachable_since
         FROM documents d
         JOIN knowledge_sources s ON s.workspace_id = d.workspace_id AND s.id = d.source_id
         LEFT JOIN document_versions v ON v.workspace_id = d.workspace_id AND v.id = d.current_version_id
        WHERE d.workspace_id = $1 AND ($2::uuid IS NULL OR d.bot_id = $2)
          AND ($3::uuid IS NULL OR d.id < $3)
          AND (d.status = 'unreachable' OR
               COALESCE(d.last_checked_at, v.created_at) < now() - ($4 * interval '1 day'))
        ORDER BY d.id DESC LIMIT $5`,
      [input.workspaceId, input.botId ?? null, input.cursor ?? null, input.days, input.limit + 1],
    );
    return {
      data: rows.slice(0, input.limit).map((row) => ({
        documentId: row.document_id,
        sourceId: row.source_id,
        botId: row.bot_id,
        title: row.title,
        url: row.url,
        status: row.status,
        lastCheckedAt: row.last_checked_at,
        lastChangedAt: row.last_changed_at,
        unreachableSince: row.unreachable_since,
      })),
      hasMore: rows.length > input.limit,
    };
  }
}
