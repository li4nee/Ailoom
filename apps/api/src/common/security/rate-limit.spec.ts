// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { assertRateLimitRegistration, rateLimitOptions } from './rate-limit';

describe('rate limit registration', () => {
  it('registers every route policy at startup', () => {
    expect(() => {
      assertRateLimitRegistration(rateLimitOptions());
    }).not.toThrow();
  });

  it('rejects a route whose policy is missing', () => {
    expect(() => {
      assertRateLimitRegistration([{ name: 'login' }]);
    }).toThrow('rate limit route "signup" needs policy "signup"');
  });

  it('rejects duplicate or unnamed policies', () => {
    expect(() => {
      assertRateLimitRegistration([{ name: 'login' }, { name: 'login' }]);
    }).toThrow('unique, non-empty names');
    expect(() => {
      assertRateLimitRegistration([{ name: 'login' }, {}]);
    }).toThrow('unique, non-empty names');
  });
});
