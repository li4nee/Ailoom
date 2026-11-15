// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

/**
 * One debounced agent-reply email per conversation (spec §17.7). Every agent reply enqueues
 * with the same `singletonKey`, so while this delayed job is queued, later replies join it
 * instead of scheduling another email.
 */
export const AGENT_REPLY_EMAIL_JOB = defineJob({
  name: 'conversation.agent_reply_email',
  schema: z.object({
    workspaceId: z.uuid(),
    conversationId: z.uuid(),
  }),
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 2,
});
