// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

/** Hard-deletes revoked auth sessions older than RETENTION_SESSIONS_DAYS. */
export const SESSION_RETENTION_JOB = defineJob({
  name: 'auth.session_retention',
  schema: z.object({
    olderThanDays: z.number().int().nonnegative(),
  }),
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 1,
});
