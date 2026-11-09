// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from './pagination';

const ID = '0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c6d';

describe('cursor pagination', () => {
  it('round-trips an id', () => {
    expect(decodeCursor(encodeCursor(ID))).toBe(ID);
  });

  it('rejects a cursor that is not a uuid', () => {
    expect(() => decodeCursor(Buffer.from('nope').toString('base64url'))).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });

  it('rejects arbitrary base64', () => {
    expect(() => decodeCursor('!!!')).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });
});
