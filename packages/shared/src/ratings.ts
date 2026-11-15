// SPDX-License-Identifier: MIT
import { z } from 'zod';

/** Thumbs up or down on an AI answer, shared by widget and admin contracts. */
export const ratingSchema = z.union([z.literal(1), z.literal(-1)]);

export type Rating = z.infer<typeof ratingSchema>;
