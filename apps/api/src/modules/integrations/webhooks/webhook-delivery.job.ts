// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../../jobs';

export const WEBHOOK_DELIVERY_JOB = defineJob({
  name: 'integrations.webhook-delivery',
  schema: z.object({
    workspaceId: z.uuid(),
    webhookId: z.uuid(),
    deliveryId: z.uuid(),
  }),
  retryLimit: 5,
  retryBackoff: true,
  retryDelaySec: 5,
  concurrency: 20,
});
