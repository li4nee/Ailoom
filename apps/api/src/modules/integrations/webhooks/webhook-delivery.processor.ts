// SPDX-License-Identifier: AGPL-3.0-only
import type { z } from 'zod';

import { asWorkspaceId } from '../../../db/ids';
import { type JobContext, type JobHandler, JobProcessor } from '../../../jobs';
import { WEBHOOK_DELIVERY_JOB } from './webhook-delivery.job';
import { WebhooksService } from './webhooks.service';

@JobProcessor(WEBHOOK_DELIVERY_JOB)
export class WebhookDeliveryProcessor implements JobHandler<
  z.infer<typeof WEBHOOK_DELIVERY_JOB.schema>
> {
  constructor(private readonly webhooks: WebhooksService) {}

  async handle(
    payload: z.infer<typeof WEBHOOK_DELIVERY_JOB.schema>,
    ctx: JobContext,
  ): Promise<void> {
    if (ctx.signal.aborted) throw new Error('webhook delivery job aborted');
    await this.webhooks.deliver(
      asWorkspaceId(payload.workspaceId),
      payload.webhookId,
      payload.deliveryId,
    );
  }
}
