// SPDX-License-Identifier: AGPL-3.0-only
import { PinoLogger } from 'nestjs-pino';

import { type JobHandler, JobProcessor } from '../../jobs';
import { WORKSPACE_PURGE_JOB } from './workspace-purge.job';
import { WorkspacePurgeRepository } from './workspace-purge.repository';

/**
 * Runs in the worker. A failure throws so pg-boss retries; every step is idempotent, so a
 * retry after a partial purge continues where the last attempt stopped. File blobs are added
 * by Task 3.1.
 */
@JobProcessor(WORKSPACE_PURGE_JOB)
export class WorkspacePurgeProcessor implements JobHandler<{ workspaceId: string }> {
  constructor(
    private readonly purge: WorkspacePurgeRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkspacePurgeProcessor.name);
  }

  async handle(payload: { workspaceId: string }): Promise<void> {
    await this.purge.purge(payload.workspaceId);
    this.logger.info({ workspaceId: payload.workspaceId }, 'workspace purged');
  }
}
