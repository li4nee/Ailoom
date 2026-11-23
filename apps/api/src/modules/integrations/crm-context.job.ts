// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

export const CRM_CONTEXT_JOB = defineJob({
  name: 'integrations.crm_contact_context',
  schema: z.object({ workspaceId: z.uuid(), conversationId: z.uuid() }),
  retryLimit: 2,
  retryBackoff: true,
  concurrency: 2,
});
