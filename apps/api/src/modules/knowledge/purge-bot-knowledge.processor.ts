// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';

import { asWorkspaceId } from '../../db/ids';
import { type JobHandler, JobProcessor } from '../../jobs';
import { DeletionService } from './deletion.service';
import { PURGE_BOT_KNOWLEDGE_JOB } from './knowledge.jobs';

/**
 * A soft-deleted bot keeps its rows for audit, but its knowledge must stop costing space: every
 * source is purged exactly as a manual delete would (spec §12.8). Idempotent, so a retry after
 * a partial run finishes the rest.
 */
@Injectable()
@JobProcessor(PURGE_BOT_KNOWLEDGE_JOB)
export class PurgeBotKnowledgeProcessor implements JobHandler<{
  workspaceId: string;
  botId: string;
}> {
  constructor(private readonly deletion: DeletionService) {}

  async handle(payload: { workspaceId: string; botId: string }): Promise<void> {
    await this.deletion.purgeBot(asWorkspaceId(payload.workspaceId), payload.botId);
  }
}
