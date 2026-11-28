// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { piiRedactionCategoriesSchema } from './privacy.js';

describe('piiRedactionCategoriesSchema', () => {
  it('accepts an empty or unique category selection', () => {
    expect(piiRedactionCategoriesSchema.parse([])).toEqual([]);
    expect(piiRedactionCategoriesSchema.parse(['email', 'credentials'])).toEqual([
      'email',
      'credentials',
    ]);
  });

  it('rejects unknown and duplicate categories', () => {
    expect(piiRedactionCategoriesSchema.safeParse(['address']).success).toBe(false);
    expect(piiRedactionCategoriesSchema.safeParse(['email', 'email']).success).toBe(false);
  });
});
