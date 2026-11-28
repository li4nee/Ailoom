// SPDX-License-Identifier: MIT
import { z } from 'zod';

export const PII_REDACTION_CATEGORIES = ['email', 'phone', 'payment_card', 'credentials'] as const;
export const piiRedactionCategoriesSchema = z
  .array(z.enum(PII_REDACTION_CATEGORIES))
  .max(PII_REDACTION_CATEGORIES.length)
  .refine((categories) => new Set(categories).size === categories.length);
export type PiiRedactionCategory = (typeof PII_REDACTION_CATEGORIES)[number];
