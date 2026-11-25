// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { WorkspaceId } from '../../../db/ids';
import { notifyWorkspace } from '../../realtime';
import { SourcesRepository } from '../sources.repository';

export interface PageOutcome {
  ok: boolean;
  warnings: number;
  /** User-facing reason, when `ok` is false. */
  error?: string;
}

/**
 * TypeORM's Postgres `query()` returns `[rows, affectedCount]` for an UPDATE with RETURNING,
 * and plain rows for a SELECT. The first row is in a different place in each shape.
 */
function firstRow(result: unknown): Counters | undefined {
  const outer = result as unknown[];
  const rows = Array.isArray(outer[0]) ? (outer[0] as unknown[]) : outer;
  return rows[0] as Counters | undefined;
}

interface Counters {
  bot_id: string;
  status: string;
  pages_total: number;
  pages_done: number;
  pages_failed: number;
  warning_count: number;
  error: string | null;
}

/**
 * Counts finished pages and decides when a source is done (spec §12.2). The counter update is
 * one `UPDATE … RETURNING` per page, so two page jobs finishing at once cannot lose a count;
 * the final transition happens in the same transaction that reads the counters, guarded by
 * `status = 'processing'` so a late page cannot reopen a source that was already deleted.
 */
@Injectable()
export class ProgressService {
  constructor(
    private readonly ds: DataSource,
    private readonly sources: SourcesRepository,
  ) {}

  async pageDone(workspaceId: WorkspaceId, sourceId: string, outcome: PageOutcome): Promise<void> {
    await this.ds.transaction(async (manager) => {
      const result: unknown = await manager.query(
        `UPDATE knowledge_sources
            SET pages_done = pages_done + $3,
                pages_failed = pages_failed + $4,
                warning_count = warning_count + $5,
                error = COALESCE($6, error)
          WHERE workspace_id = $1 AND id = $2
          RETURNING bot_id, status, pages_total, pages_done, pages_failed, warning_count, error`,
        [
          workspaceId,
          sourceId,
          outcome.ok ? 1 : 0,
          outcome.ok ? 0 : 1,
          outcome.ok ? outcome.warnings : 0,
          outcome.error ?? null,
        ],
      );
      const counters = firstRow(result);
      if (counters === undefined) return;
      await this.finishIfComplete(manager, workspaceId, sourceId, counters);
    });
  }

  /** Sets the page count a source starts with, before any page job runs. */
  async setTotal(
    manager: EntityManager,
    workspaceId: WorkspaceId,
    sourceId: string,
    total: number,
  ): Promise<void> {
    await manager.query(
      `UPDATE knowledge_sources SET pages_total = $3 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, sourceId, total],
    );
  }

  async fail(workspaceId: WorkspaceId, sourceId: string, error: string): Promise<void> {
    await this.ds.transaction(async (manager) => {
      await manager.query(
        `UPDATE knowledge_sources SET status = 'failed', error = $3
          WHERE workspace_id = $1 AND id = $2 AND status <> 'deleting'`,
        [workspaceId, sourceId, error],
      );
      await this.notifySource(manager, workspaceId, sourceId, 'failed');
    });
  }

  private async finishIfComplete(
    manager: EntityManager,
    workspaceId: WorkspaceId,
    sourceId: string,
    counters: Counters,
  ): Promise<void> {
    if (counters.status !== 'processing' && counters.status !== 'pending') return;
    if (counters.pages_done + counters.pages_failed < counters.pages_total) return;
    if (counters.pages_total === 0 && counters.pages_done === 0) return;

    // A crawl where every page failed is a failed source; one page of many is only a warning.
    const failed = counters.pages_done === 0 && counters.pages_failed > 0;
    const status = failed ? 'failed' : 'ready';
    // `$3` and `$4` are the same text: Postgres infers the type of one parameter from its
    // first use, and an enum assignment and a text comparison cannot share one.
    const result: unknown = await manager.query(
      `UPDATE knowledge_sources
          SET status = $3::source_status,
              error = CASE WHEN $4 = 'failed' THEN error ELSE NULL END,
              last_synced_at = now()
        WHERE workspace_id = $1 AND id = $2 AND status IN ('processing', 'pending')
        RETURNING status`,
      [workspaceId, sourceId, status, status],
    );
    if (firstRow(result) === undefined) return;
    await this.notifySource(manager, workspaceId, sourceId, status);
  }

  private async notifySource(
    manager: EntityManager,
    workspaceId: WorkspaceId,
    sourceId: string,
    status: 'ready' | 'failed' | 'processing' | 'pending' | 'deleting',
  ): Promise<void> {
    const source = await this.sources.findById(workspaceId, sourceId, manager);
    if (source === null) return;
    await notifyWorkspace(manager, workspaceId, {
      type: 'source.updated',
      sourceId,
      botId: source.botId,
      status,
    });
  }
}
