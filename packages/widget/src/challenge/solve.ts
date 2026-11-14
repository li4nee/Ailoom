// SPDX-License-Identifier: MIT
import type { Challenge } from 'altcha-lib/v1/types';

import { encodeSolution } from './payload';

export type AltchaChallenge = Challenge;

/** The same budget the server signs into the challenge. */
const DEFAULT_MAX_NUMBER = 50_000;

function aborted(): DOMException {
  return new DOMException('The challenge was aborted.', 'AbortError');
}

async function solveWithWorker(challenge: AltchaChallenge, signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let worker: Worker;
    try {
      // A runtime URL, not the `new URL('./file', import.meta.url)` literal Vite bundles
      // automatically: `vite.worker.config.ts` builds this file as a classic worker.
      const url = new URL(/* @vite-ignore */ `./challenge-worker.js`, import.meta.url);
      worker = new Worker(url);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const finish = (): void => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = (): void => {
      finish();
      reject(aborted());
    };

    worker.addEventListener(
      'message',
      (event: MessageEvent<{ payload?: string; error?: string }>) => {
        const data = event.data;
        finish();
        if (typeof data.payload === 'string') resolve(data.payload);
        else reject(new Error(data.error ?? 'The challenge worker returned no solution.'));
      },
    );
    worker.addEventListener('error', () => {
      finish();
      reject(new Error('The challenge worker failed.'));
    });
    signal.addEventListener('abort', onAbort, { once: true });
    worker.postMessage({ challenge });
  });
}

/** The CSP fallback: solve on the main thread (a short, ~0.5–1 s block). */
export async function solveLocally(
  challenge: AltchaChallenge,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted === true) throw aborted();
  const { solveChallenge } = await import('altcha-lib/v1');
  const solver = solveChallenge(
    challenge.challenge,
    challenge.salt,
    challenge.algorithm,
    challenge.maxnumber ?? DEFAULT_MAX_NUMBER,
  );
  const onAbort = (): void => {
    solver.controller.abort();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const solution = await solver.promise;
    if (solution === null) throw new Error('The challenge could not be solved.');
    return encodeSolution(challenge, solution.number);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Solves in a Web Worker so the page stays responsive; if workers are blocked by the host
 * page's CSP (or unavailable), it falls back to the main thread. Either way the result is the
 * base64 payload `POST /sessions` expects.
 */
export async function solveInWorker(
  challenge: AltchaChallenge,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw aborted();
  if (typeof Worker !== 'undefined') {
    try {
      return await solveWithWorker(challenge, signal);
    } catch {
      // CSP-blocked workers land here; solving on the main thread still works. An aborted
      // signal is re-thrown by `solveLocally` below.
    }
  }
  return solveLocally(challenge, signal);
}
