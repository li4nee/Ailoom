// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

export const HANDOFF_SUMMARY_JOB = defineJob({
  name: 'agent_assist.handoff_summary',
  schema: z.object({
    workspaceId: z.uuid(),
    botId: z.uuid(),
    conversationId: z.uuid(),
    artifactId: z.uuid(),
  }),
  retryLimit: 0,
  retryBackoff: false,
  concurrency: 2,
});
