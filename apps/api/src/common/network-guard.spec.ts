// SPDX-License-Identifier: AGPL-3.0-only
import { getGlobalDispatcher, MockAgent } from 'undici';
import { describe, expect, it } from 'vitest';

// `test/setup.ts` installs the guard for every Vitest project; this proves the unit project
// loads it too, so a unit test cannot quietly reach the real network.
describe('network guard in unit tests', () => {
  it('installs a MockAgent as the global dispatcher', () => {
    expect(getGlobalDispatcher()).toBeInstanceOf(MockAgent);
  });

  it('refuses a request to a public host without connecting', async () => {
    const failure: unknown = await fetch('http://network-guard.invalid/').then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as { cause?: { code?: string } }).cause?.code).toBe(
      'UND_MOCK_ERR_MOCK_NOT_MATCHED',
    );
  });
});
