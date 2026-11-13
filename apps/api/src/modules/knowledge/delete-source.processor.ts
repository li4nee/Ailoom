// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable, Logger } from '@nestjs/common';

import { asWorkspaceId } from '../../db/ids';
import { type JobHandler, JobProcessor } from '../../jobs';
import { DeletionService } from './deletion.service';
import { DELETE_SOURCE_JOB } from './knowledge.jobs';

/**
 * Spec §12.8. The api only marks a source `deleting`; the worker removes its chunks, versions,
 * documents, file rows and blob. A failure throws so pg-boss retries; every step is idempotent.
 */
@Injectable()
@JobProcessor(DELETE_SOURCE_JOB)
export class DeleteSourceProcessor implements JobHandler<{
  workspaceId: string;
  sourceId: string;
}> {
  private readonly logger = new Logger(DeleteSourceProcessor.name);

  constructor(private readonly deletion: DeletionService) {}

  async handle(payload: { workspaceId: string; sourceId: string }): Promise<void> {
    const purged = await this.deletion.purgeSource(
      asWorkspaceId(payload.workspaceId),
      payload.sourceId,
    );
    if (purged) {
      this.logger.log(`source ${payload.sourceId} deleted`);
    }
  }
}
