// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { randomToken } from './hash';

describe('crypto hash helpers', () => {
  it('randomToken has 256 bits', () => {
    expect(Buffer.from(randomToken(), 'base64url')).toHaveLength(32);
  });
});
