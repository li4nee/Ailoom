// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

const workspaceAndSource = z.object({ workspaceId: z.uuid(), sourceId: z.uuid() });

/** Resolves a source into pages/documents and enqueues one `IngestPage` per page. */
export const INGEST_SOURCE_JOB = defineJob({
  name: 'knowledge.ingest_source',
  schema: workspaceAndSource,
  retryLimit: 2,
  retryBackoff: false,
  concurrency: 4,
});

/** Fetches, extracts and records one page; the crawl's unit of work. */
export const INGEST_PAGE_JOB = defineJob({
  name: 'knowledge.ingest_page',
  schema: z.object({
    workspaceId: z.uuid(),
    sourceId: z.uuid(),
    documentId: z.uuid().nullable(),
    url: z.string().max(2048).nullable(),
  }),
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 8,
});

/** Embeds the chunks of one document version. */
export const EMBED_CHUNKS_JOB = defineJob({
  name: 'knowledge.embed_chunks',
  schema: z.object({
    workspaceId: z.uuid(),
    botId: z.uuid(),
    documentVersionId: z.uuid(),
    embeddingModel: z.string().min(1).max(200),
  }),
  retryLimit: 5,
  retryBackoff: true,
  concurrency: 4,
});

/** Deletes a source's documents, chunks, file row and blob, then notifies. */
export const DELETE_SOURCE_JOB = defineJob({
  name: 'knowledge.delete_source',
  schema: workspaceAndSource,
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 2,
});

/** Removes every source of a soft-deleted bot, in the background. */
export const PURGE_BOT_KNOWLEDGE_JOB = defineJob({
  name: 'knowledge.purge_bot',
  schema: z.object({ workspaceId: z.uuid(), botId: z.uuid() }),
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 1,
});

/** Re-embeds a bot's chunks for a new model, cancellable by generation. */
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
