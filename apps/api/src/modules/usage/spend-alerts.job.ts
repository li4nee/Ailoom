// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

/**
 * Spec §15.2: one email per threshold per bot per UTC month. The singleton key dedupes a burst
 * of finalizes that cross the same threshold together; `ChatPersistence` additionally only
 * enqueues on the crossing itself, so later answers do not enqueue again.
 */
export const SPEND_ALERTS_JOB = defineJob({
  name: 'usage.alerts',
  schema: z.object({
    workspaceId: z.uuid(),
    botId: z.uuid(),
    threshold: z.union([z.literal(80), z.literal(100)]),
    month: z.string().regex(/^\d{4}-\d{2}$/),
  }),
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 2,
});
