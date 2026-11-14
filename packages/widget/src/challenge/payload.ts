// SPDX-License-Identifier: MIT
import type { Challenge as AltchaChallenge } from 'altcha-lib/v1/types';

/** The ALTCHA payload the API verifies: base64 of the solved challenge (spec §10.4). */
export function encodeSolution(challenge: AltchaChallenge, number: number): string {
  return btoa(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      number,
      salt: challenge.salt,
      signature: challenge.signature,
    }),
  );
}
