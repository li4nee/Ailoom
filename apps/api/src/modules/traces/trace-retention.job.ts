// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

/** Hard-deletes generation traces older than RETENTION_TRACES_DAYS (0 = disabled). */
export const TRACE_RETENTION_JOB = defineJob({
  name: 'trace.retention',
  schema: z.object({
    olderThanDays: z.number().int().nonnegative(),
  }),
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 1,
});
