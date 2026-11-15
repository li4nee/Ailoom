// SPDX-License-Identifier: MIT
import { z } from 'zod';

/** One source an AI answer cites (spec §13.6), as stored on the message. */
export const citationSchema = z.object({
  n: z.number().int(),
  chunkId: z.string(),
  documentId: z.string(),
  title: z.string(),
  url: z.string().nullable(),
});

export type Citation = z.infer<typeof citationSchema>;
