// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { PROVIDER_ERROR_CODES, type ProviderErrorCode } from '@app/shared';

import { ProviderError } from '../../../providers';
import { FAILOVER_CODES, shouldFailOver } from './fallback';

describe('shouldFailOver', () => {
  it('allows each eligible provider error before the first delta', () => {
    for (const code of FAILOVER_CODES) {
      expect(shouldFailOver(new ProviderError(code), false, new AbortController().signal)).toBe(
        true,
      );
    }
  });

  it('rejects aborts, policy blocks, mid-stream errors, and non-provider errors', () => {
    const signal = new AbortController().signal;
    expect(shouldFailOver(new ProviderError('aborted'), false, signal)).toBe(false);
    expect(shouldFailOver(new ProviderError('blocked_url'), false, signal)).toBe(false);
    expect(shouldFailOver(new ProviderError('rate_limited'), true, signal)).toBe(false);
    expect(shouldFailOver(new Error('network error'), false, signal)).toBe(false);
    expect(shouldFailOver('rate_limited', false, signal)).toBe(false);
  });

  it('rejects every provider code after the visitor signal aborts', () => {
    const controller = new AbortController();
    controller.abort();
    for (const code of PROVIDER_ERROR_CODES as readonly ProviderErrorCode[]) {
      expect(shouldFailOver(new ProviderError(code), false, controller.signal)).toBe(false);
    }
  });
});
