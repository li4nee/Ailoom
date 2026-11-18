// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

export const INTEGRATION_EVENT_JOB = defineJob({
  name: 'integrations.dispatch-event',
  schema: z.object({ eventId: z.uuid(), workspaceId: z.uuid(), leaseOwner: z.string().min(1) }),
  retryLimit: 5,
  retryBackoff: true,
  retryDelaySec: 5,
  concurrency: 10,
});
