// SPDX-License-Identifier: MIT
import { z } from 'zod';

/** Query parameters accepted by every cursor-paginated list endpoint. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

/** A page of rows plus the cursor that fetches the next, older page (`null` at the end). */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
