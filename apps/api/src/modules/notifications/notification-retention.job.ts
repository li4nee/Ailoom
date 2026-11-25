// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

export const NOTIFICATION_RETENTION_JOB = defineJob({
  name: 'notification.retention',
  schema: z.object({}),
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 1,
});
