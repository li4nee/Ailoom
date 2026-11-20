// SPDX-License-Identifier: MIT
import { z } from 'zod';

export const internalNoteSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  author: z.object({ id: z.uuid(), name: z.string().nullable() }).nullable(),
  body: z.string().max(4000).nullable(),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  deletedBy: z.object({ id: z.uuid(), name: z.string().nullable() }).nullable(),
});

export const internalNoteWriteSchema = z.object({ body: z.string().trim().min(1).max(4000) });
export const internalNoteUpdateSchema = internalNoteWriteSchema.extend({
  expectedVersion: z.number().int().min(1),
});
export const internalNoteDeleteSchema = z.object({ expectedVersion: z.number().int().min(1) });

export type InternalNote = z.infer<typeof internalNoteSchema>;
export type InternalNoteWrite = z.infer<typeof internalNoteWriteSchema>;
export type InternalNoteUpdate = z.infer<typeof internalNoteUpdateSchema>;
export type InternalNoteDelete = z.infer<typeof internalNoteDeleteSchema>;
