// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

/** Hard-deletes conversations older than RETENTION_CONVERSATIONS_DAYS (0 = disabled). */
export const CONVERSATION_RETENTION_JOB = defineJob({
  name: 'conversation.retention',
  schema: z.object({
    olderThanDays: z.number().int().nonnegative(),
  }),
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 1,
});
