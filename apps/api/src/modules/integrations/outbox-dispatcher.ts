// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';

import { Clock } from '../../common/clock';
import { newId } from '../../common/ids';
import { JobsService } from '../../jobs';
import { INTEGRATION_EVENT_JOB } from './integration-event.job';
import { OutboxRepository } from './outbox.repository';

/** Claims committed events and hands them to pg-boss without holding a business transaction. */
@Injectable()
export class OutboxDispatcher {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly jobs: JobsService,
    private readonly clock: Clock,
  ) {}

  async dispatch(limit = 100): Promise<number> {
    const leaseOwner = newId();
    const claimed = await this.outbox.claimBatch(limit, leaseOwner, this.clock.now(), 60_000);
    let queued = 0;
    for (const event of claimed) {
      try {
        await this.jobs.enqueue(INTEGRATION_EVENT_JOB, {
          eventId: event.id,
          workspaceId: event.workspaceId,
          leaseOwner,
        });
        queued += 1;
      } catch (error) {
        await this.outbox.releaseLease(event.id, leaseOwner);
        throw error;
      }
    }
    return queued;
  }
}
