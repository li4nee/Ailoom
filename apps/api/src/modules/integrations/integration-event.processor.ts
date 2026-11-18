// SPDX-License-Identifier: AGPL-3.0-only
import type { z } from 'zod';

import { Clock } from '../../common/clock';
import { asWorkspaceId } from '../../db/ids';
import { type JobContext, type JobHandler, JobProcessor } from '../../jobs';
import type { IntegrationEvent } from './connectors/connector';
import { INTEGRATION_EVENT_JOB } from './integration-event.job';
import { IntegrationsService } from './integrations.service';
import { OutboxRepository } from './outbox.repository';
import { WebhooksService } from './webhooks/webhooks.service';

@JobProcessor(INTEGRATION_EVENT_JOB)
export class IntegrationEventProcessor implements JobHandler<
  z.infer<typeof INTEGRATION_EVENT_JOB.schema>
> {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly integrations: IntegrationsService,
    private readonly webhooks: WebhooksService,
    private readonly clock: Clock,
  ) {}

  async handle(
    payload: z.infer<typeof INTEGRATION_EVENT_JOB.schema>,
    ctx: JobContext,
  ): Promise<void> {
    if (ctx.signal.aborted) throw new Error('integration event job aborted');
    const workspaceId = asWorkspaceId(payload.workspaceId);
    const event = await this.outbox.findById(workspaceId, payload.eventId);
    if (event === null) return;
    const envelope: IntegrationEvent = {
      id: event.id,
      version: 1,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt.toISOString(),
      data: event.data,
      workspaceId: event.workspaceId,
      type: event.type,
    };
    await this.integrations.handleEvent(envelope);
    await this.webhooks.enqueueEvent(envelope);
    await this.outbox.markDispatched(event.id, payload.leaseOwner, this.clock.now());
  }
}
