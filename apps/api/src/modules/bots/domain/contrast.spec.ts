// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { contrastText } from '@app/shared';

describe('contrastText', () => {
  it.each([
    ['#ffffff', '#000000'],
    ['#000000', '#ffffff'],
    ['#2563eb', '#ffffff'],
    ['#facc15', '#000000'],
  ])('picks the readable text color on %s', (background, expected) => {
    expect(contrastText(background)).toBe(expected);
  });

  it('accepts an uppercase hex', () => {
    expect(contrastText('#FACC15')).toBe('#000000');
  });
});
