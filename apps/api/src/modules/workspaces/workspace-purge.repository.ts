// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { PURGE_ORDER } from './workspace-purge.job';

export const PURGE_BATCH_SIZE = 1000;

/**
 * Raw SQL: TypeORM has no batched delete, and the table names come from the fixed
 * `PURGE_ORDER` constant, never from input. Each statement removes at most `batchSize` rows so
 * a large workspace never holds long locks or bloats one transaction.
 */
@Injectable()
export class WorkspacePurgeRepository {
  constructor(private readonly ds: DataSource) {}

  /** Idempotent, and a no-op unless the workspace is marked deleted. */
  async purge(workspaceId: string, batchSize = PURGE_BATCH_SIZE): Promise<void> {
    if (!(await this.isMarkedDeleted(workspaceId))) return;
    for (const table of PURGE_ORDER) {
      let deleted: number;
      do {
        const result = await this.ds.query<[unknown[], number]>(
          `DELETE FROM "${table}" WHERE ctid IN (
             SELECT ctid FROM "${table}" WHERE workspace_id = $1 LIMIT $2
           )`,
          [workspaceId, batchSize],
        );
        deleted = result[1];
      } while (deleted > 0);
    }
    await this.ds.query('DELETE FROM workspaces WHERE id = $1 AND deleted_at IS NOT NULL', [
      workspaceId,
    ]);
  }

  private async isMarkedDeleted(workspaceId: string): Promise<boolean> {
    const rows = await this.ds.query<unknown[]>(
      'SELECT 1 FROM workspaces WHERE id = $1 AND deleted_at IS NOT NULL',
      [workspaceId],
    );
    return rows.length > 0;
  }
}
