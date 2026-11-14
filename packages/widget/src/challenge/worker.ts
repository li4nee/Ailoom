// SPDX-License-Identifier: MIT
import { solveChallenge } from 'altcha-lib/v1';
import type { Challenge } from 'altcha-lib/v1/types';

import { encodeSolution } from './payload';

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ challenge: Challenge }>) => void) | null;
  postMessage: (message: unknown) => void;
}

const scope = self as unknown as WorkerScope;

/** Solves one signed challenge and posts the base64 payload the widget submits. */
scope.onmessage = (event) => {
  const { challenge } = event.data;
  void (async () => {
    const solution = await solveChallenge(
      challenge.challenge,
      challenge.salt,
      challenge.algorithm,
      challenge.maxnumber ?? 50_000,
    ).promise;
    if (solution === null) {
      scope.postMessage({ error: 'The challenge could not be solved.' });
      return;
    }
    scope.postMessage({ payload: encodeSolution(challenge, solution.number) });
  })().catch((error: unknown) => {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  });
};
