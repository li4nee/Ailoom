// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { slugify } from './slug';

describe('slugify', () => {
  it.each([
    ['Acme Inc.', 'acme-inc'],
    ['  Ünïcödé  ', 'unicode'],
    ['!!!', 'workspace'],
    ['A'.repeat(60), 'a'.repeat(40)],
    ['hello   world', 'hello-world'],
  ])('slugify(%s)', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});
