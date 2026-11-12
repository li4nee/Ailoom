// SPDX-License-Identifier: AGPL-3.0-only
import { Inject } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { FILE_STORAGE, type FileStorage } from '../../common/storage';
import { type JobHandler, JobProcessor } from '../../jobs';
import { WORKSPACE_PURGE_JOB } from './workspace-purge.job';
import { WorkspacePurgeRepository } from './workspace-purge.repository';

const BLOB_BATCH_SIZE = 500;

/**
 * Runs in the worker. A failure throws so pg-boss retries; every step is idempotent, so a
 * retry after a partial purge continues where the last attempt stopped.
 *
 * Blobs go first: their keys live only in the `files` rows, so deleting the rows first would
 * orphan every blob with no way to find it again.
 */
@JobProcessor(WORKSPACE_PURGE_JOB)
export class WorkspacePurgeProcessor implements JobHandler<{ workspaceId: string }> {
  constructor(
    private readonly purge: WorkspacePurgeRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkspacePurgeProcessor.name);
  }

  async handle(payload: { workspaceId: string }): Promise<void> {
    if (!(await this.purge.isMarkedDeleted(payload.workspaceId))) return;
    await this.deleteBlobs(payload.workspaceId);
    await this.purge.purge(payload.workspaceId);
    this.logger.info({ workspaceId: payload.workspaceId }, 'workspace purged');
  }

  private async deleteBlobs(workspaceId: string): Promise<void> {
    let cursor: string | null = null;
    for (;;) {
      const batch = await this.purge.listStorageKeys(workspaceId, cursor, BLOB_BATCH_SIZE);
      if (batch.length === 0) return;
      for (const row of batch) await this.storage.delete(row.storageKey);
      cursor = batch[batch.length - 1]?.id ?? null;
      if (cursor === null) return;
    }
  }
}
