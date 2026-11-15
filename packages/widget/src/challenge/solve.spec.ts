// SPDX-License-Identifier: MIT
import { createChallenge, verifySolution } from 'altcha-lib/v1';
import { describe, expect, it } from 'vitest';

import { solveLocally } from './solve';

describe('solveLocally', () => {
  it('produces a payload verifySolution accepts', async () => {
    const hmacKey = 'widget-test-key';
    const challenge = await createChallenge({ hmacKey, maxNumber: 500 });

    const payload = await solveLocally(challenge);

    await expect(verifySolution(payload, hmacKey, false)).resolves.toBe(true);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const challenge = await createChallenge({ hmacKey: 'widget-test-key', maxNumber: 500 });
    const controller = new AbortController();
    controller.abort();

    await expect(solveLocally(challenge, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
