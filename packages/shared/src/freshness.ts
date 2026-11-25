// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { DOCUMENT_STATUSES } from './enums.js';

export const manualDocumentContentSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(200 * 1024),
});

export const freshnessQuerySchema = z.object({
  botId: z.uuid().optional(),
  days: z.coerce.number().int().min(7).max(365).default(90),
  cursor: z.uuid().optional(),
});

export const documentVersionSchema = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  contentHash: z.string(),
  editedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  isCurrent: z.boolean(),
});

export const versionDiffSchema = z.object({
  hunks: z.array(
    z.object({
      oldStart: z.number().int(),
      oldLines: z.number().int(),
      newStart: z.number().int(),
      newLines: z.number().int(),
      lines: z.array(z.object({ kind: z.enum(['add', 'remove', 'context']), text: z.string() })),
    }),
  ),
  truncated: z.boolean(),
});

export const freshnessItemSchema = z.object({
  documentId: z.uuid(),
  sourceId: z.uuid(),
  botId: z.uuid(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  status: z.enum(DOCUMENT_STATUSES),
  lastCheckedAt: z.string().nullable(),
  lastChangedAt: z.string().nullable(),
  unreachableSince: z.string().nullable(),
});

export type FreshnessQuery = z.infer<typeof freshnessQuerySchema>;
export type DocumentVersionDto = z.infer<typeof documentVersionSchema>;
export type VersionDiffDto = z.infer<typeof versionDiffSchema>;
export type FreshnessItemDto = z.infer<typeof freshnessItemSchema>;
export type ManualDocumentContentRequest = z.infer<typeof manualDocumentContentSchema>;
