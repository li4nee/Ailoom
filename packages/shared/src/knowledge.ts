// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { DOCUMENT_STATUSES, EXTRACTION_WARNINGS, SOURCE_STATUSES, SOURCE_TYPES } from './enums.js';

/** Spec §12.1: a pasted text source may be 200 KB. */
export const TEXT_SOURCE_MAX_BYTES = 200 * 1024;

/** Spec §12.1: a sitemap source may include 500 pages. */
export const CRAWL_MAX_PAGES_DEFAULT = 500;

/** Default `MAX_UPLOAD_MB`; the admin warns before sending anything larger. */
export const UPLOAD_MAX_BYTES_DEFAULT = 20 * 1024 * 1024;

const titleSchema = z.string().trim().min(1).max(200);
const httpUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);
const patternSchema = z.string().trim().min(1).max(200);
export const RECRAWL_INTERVALS = ['1 day', '7 days', '30 days'] as const;
export type RecrawlInterval = (typeof RECRAWL_INTERVALS)[number];
const recrawlIntervalSchema = z.enum(RECRAWL_INTERVALS).nullable().optional();

/** A pasted document: the admin sends the text, the API extracts and chunks it. */
export const createTextSourceSchema = z.object({
  type: z.literal('text'),
  title: titleSchema,
  body: z.string().min(1).max(TEXT_SOURCE_MAX_BYTES),
  recrawlInterval: recrawlIntervalSchema,
});

/** One page to fetch and index. */
export const createUrlSourceSchema = z.object({
  type: z.literal('url'),
  url: httpUrlSchema,
  title: titleSchema.optional(),
  recrawlInterval: recrawlIntervalSchema,
});

/** A sitemap (or a site root, whose `/sitemap.xml` is discovered) to crawl. */
export const createSitemapSourceSchema = z.object({
  type: z.literal('sitemap'),
  url: httpUrlSchema,
  includePatterns: z.array(patternSchema).max(50).optional(),
  excludePatterns: z.array(patternSchema).max(50).optional(),
  maxPages: z.number().int().min(1).max(CRAWL_MAX_PAGES_DEFAULT).optional(),
  recrawlInterval: recrawlIntervalSchema,
});

/** `POST /workspaces/:ws/bots/:botId/sources`. The `type` decides the body shape. */
export const createSourceSchema = z.discriminatedUnion('type', [
  createTextSourceSchema,
  createUrlSourceSchema,
  createSitemapSourceSchema,
]);

/** Changes the recrawl schedule without changing the source content. */
export const updateSourceSchema = z.object({
  recrawlInterval: z.enum(RECRAWL_INTERVALS).nullable(),
});

/** Optional `title` next to the multipart `file` field of an upload. */
export const uploadSourceFieldsSchema = z.object({
  title: titleSchema.optional(),
});

/**
 * A source as the API returns it, including the progress counters the admin polls and the
 * realtime events keep fresh (spec §17.6). `error` is user-facing copy, never a stack trace.
 */
export const sourceDtoSchema = z.object({
  id: z.string(),
  botId: z.string(),
  type: z.enum(SOURCE_TYPES),
  title: z.string(),
  sourceUrl: z.string().nullable(),
  status: z.enum(SOURCE_STATUSES),
  error: z.string().nullable(),
  pagesTotal: z.number().int(),
  pagesDone: z.number().int(),
  pagesFailed: z.number().int(),
  warningCount: z.number().int(),
  lastSyncedAt: z.string().nullable(),
  recrawlInterval: z.enum(RECRAWL_INTERVALS).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** One page or file in a source list; `chunkCount` is of its current version. */
export const documentSummarySchema = z.object({
  id: z.string(),
  url: z.string().nullable(),
  title: z.string().nullable(),
  status: z.enum(DOCUMENT_STATUSES),
  warnings: z.array(z.enum(EXTRACTION_WARNINGS)),
  chunkCount: z.number().int(),
  lastSyncedAt: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  unreachableSince: z.string().nullable(),
});

/** `GET …/sources/:sourceId`: the source plus one page of its documents. */
export const sourceDetailSchema = sourceDtoSchema.extend({
  documents: z.array(documentSummarySchema),
  nextCursor: z.string().nullable(),
});

const documentSchema = z.object({
  id: z.string(),
  botId: z.string(),
  sourceId: z.string(),
  url: z.string().nullable(),
  title: z.string().nullable(),
  status: z.enum(DOCUMENT_STATUSES),
  lastCheckedAt: z.string().nullable(),
  unreachableSince: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** A chunk without its embedding: the viewer shows text, never vectors. */
export const chunkViewSchema = z.object({
  ordinal: z.number().int(),
  headingPath: z.string(),
  content: z.string(),
  tokenCount: z.number().int(),
  metadata: z.record(z.string(), z.unknown()),
});

/** `GET …/documents/:documentId`: the current version only, plus its ordered chunks. */
export const documentViewSchema = z.object({
  document: documentSchema,
  currentVersion: z
    .object({
      id: z.string(),
      content: z.string(),
      warnings: z.array(z.enum(EXTRACTION_WARNINGS)),
      createdAt: z.string(),
    })
    .nullable(),
  chunks: z.array(chunkViewSchema),
});

export type SourceDetailDto = z.infer<typeof sourceDetailSchema>;
export type DocumentSummaryDto = z.infer<typeof documentSummarySchema>;
export type DocumentViewDto = z.infer<typeof documentViewSchema>;
export type ChunkViewDto = z.infer<typeof chunkViewSchema>;

export type CreateTextSourceRequest = z.infer<typeof createTextSourceSchema>;
export type CreateUrlSourceRequest = z.infer<typeof createUrlSourceSchema>;
export type CreateSitemapSourceRequest = z.infer<typeof createSitemapSourceSchema>;
export type CreateSourceRequest = z.infer<typeof createSourceSchema>;
export type UpdateSourceRequest = z.infer<typeof updateSourceSchema>;
export type UploadSourceFields = z.infer<typeof uploadSourceFieldsSchema>;
export type SourceDto = z.infer<typeof sourceDtoSchema>;
