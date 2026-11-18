// SPDX-License-Identifier: MIT
import { z } from 'zod';

export const savedReplySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  sortOrder: z.number().int(),
  archivedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export const savedReplyQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

export const savedReplyWriteSchema = z.object({
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(4_000),
});

export const savedReplyOrderSchema = z.object({
  ids: z.array(z.uuid()).max(200),
});

export type SavedReply = z.infer<typeof savedReplySchema>;
export type SavedReplyQuery = z.infer<typeof savedReplyQuerySchema>;
export type SavedReplyWrite = z.infer<typeof savedReplyWriteSchema>;
export type SavedReplyOrder = z.infer<typeof savedReplyOrderSchema>;
