// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { defineJob } from '../../jobs';

/** Hard-deletes a soft-deleted workspace (spec §9.1 `workspaces.deleted_at`). */
export const WORKSPACE_PURGE_JOB = defineJob({
  name: 'workspace.purge',
  schema: z.object({ workspaceId: z.uuid() }),
  retryLimit: 3,
  retryBackoff: true,
  concurrency: 1,
});

/**
 * Every table with a `workspace_id`, children before parents, so no foreign key with
 * `NO ACTION` (e.g. `bots → provider_credentials`) blocks a delete. A test asserts this equals
 * the set of tables that have the column, so a new tenant table cannot be forgotten.
 */
export const PURGE_ORDER: readonly string[] = [
  'generation_traces',
  'usage_daily',
  'messages',
  'conversations',
  'contacts',
  'contact_external_links',
  'integration_events',
  'chunks',
  'document_versions',
  'documents',
  'knowledge_sources',
  'prompt_versions',
  'bots',
  'provider_credentials',
  'integration_credentials',
  'integrations',
  'model_prices',
  'files',
  'invitations',
  'memberships',
  'audit_log',
];
