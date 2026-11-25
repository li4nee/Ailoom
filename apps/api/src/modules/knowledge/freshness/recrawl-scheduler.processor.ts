// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';

import { Clock } from '../../../common/clock';
import { asSourceId } from '../../../db/ids';
import { JobProcessor, type JobHandler } from '../../../jobs';
import { SCHEDULE_RECRAWLS_JOB } from '../knowledge.jobs';
import { SourcesService } from '../sources.service';
import { FreshnessRepository } from './freshness.repository';

export const RECRAWL_SOURCES_PER_TICK = 25;

/** Finds due sources and queues them through the normal ingestion path. */
@Injectable()
@JobProcessor(SCHEDULE_RECRAWLS_JOB)
export class RecrawlSchedulerProcessor implements JobHandler<Record<string, never>> {
  constructor(
    private readonly freshness: FreshnessRepository,
    private readonly sources: SourcesService,
    private readonly clock: Clock,
  ) {}

  async handle(): Promise<void> {
    const due = await this.freshness.claimDueSources(this.clock.now(), RECRAWL_SOURCES_PER_TICK);
    for (const source of due) {
      await this.sources.resyncDueSource(source.workspaceId, asSourceId(source.sourceId));
    }
  }
}
