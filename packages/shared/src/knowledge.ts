// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { SOURCE_STATUSES, SOURCE_TYPES } from './enums.js';

/** Spec §12.1: a pasted text source may be 200 KB. */
export const TEXT_SOURCE_MAX_BYTES = 200 * 1024;

/** Spec §12.1: a sitemap source may include 500 pages. */
export const CRAWL_MAX_PAGES_DEFAULT = 500;

const titleSchema = z.string().trim().min(1).max(200);
const httpUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);
const patternSchema = z.string().trim().min(1).max(200);

/** A pasted document: the admin sends the text, the API extracts and chunks it. */
export const createTextSourceSchema = z.object({
  type: z.literal('text'),
  title: titleSchema,
  body: z.string().min(1).max(TEXT_SOURCE_MAX_BYTES),
});

/** One page to fetch and index. */
export const createUrlSourceSchema = z.object({
  type: z.literal('url'),
  url: httpUrlSchema,
  title: titleSchema.optional(),
});

/** A sitemap (or a site root, whose `/sitemap.xml` is discovered) to crawl. */
export const createSitemapSourceSchema = z.object({
  type: z.literal('sitemap'),
  url: httpUrlSchema,
  includePatterns: z.array(patternSchema).max(50).optional(),
  excludePatterns: z.array(patternSchema).max(50).optional(),
  maxPages: z.number().int().min(1).max(CRAWL_MAX_PAGES_DEFAULT).optional(),
});

/** `POST /workspaces/:ws/bots/:botId/sources`. The `type` decides the body shape. */
export const createSourceSchema = z.discriminatedUnion('type', [
  createTextSourceSchema,
  createUrlSourceSchema,
  createSitemapSourceSchema,
]);

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
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateTextSourceRequest = z.infer<typeof createTextSourceSchema>;
export type CreateUrlSourceRequest = z.infer<typeof createUrlSourceSchema>;
export type CreateSitemapSourceRequest = z.infer<typeof createSitemapSourceSchema>;
export type CreateSourceRequest = z.infer<typeof createSourceSchema>;
export type UploadSourceFields = z.infer<typeof uploadSourceFieldsSchema>;
export type SourceDto = z.infer<typeof sourceDtoSchema>;
