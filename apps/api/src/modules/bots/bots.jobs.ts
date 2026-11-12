// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

/**
 * A bot's embedding change and its deletion both touch knowledge rows, but the triggers belong
 * to the bot lifecycle: defining them here keeps `bots` independent of the knowledge module,
 * which imports `bots` for its repository and entity.
 */
export const REEMBED_BOT_JOB = defineJob({
  name: 'knowledge.reembed_bot',
  schema: z.object({
    workspaceId: z.uuid(),
    botId: z.uuid(),
    targetModel: z.string().min(1).max(200),
    targetCredentialId: z.uuid(),
    generation: z.number().int().min(1),
  }),
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 1,
});

/** Removes every source of a soft-deleted bot, in the background. */
export const PURGE_BOT_KNOWLEDGE_JOB = defineJob({
  name: 'knowledge.purge_bot',
  schema: z.object({ workspaceId: z.uuid(), botId: z.uuid() }),
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 1,
});
