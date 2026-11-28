// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

export const REVIEW_SLA_BREACHES_JOB = defineJob({
  name: 'conversations.review_sla_breaches',
  schema: z.object({}),
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 1,
});

export const SLA_REVIEW_SCHEDULE = '* * * * *';
