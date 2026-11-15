// SPDX-License-Identifier: AGPL-3.0-only
import { solveChallenge } from 'altcha-lib/v1';
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../common/clock';
import { type AppConfig, loadConfig } from '../../common/config';
import { ChallengeService } from './challenge.service';

const NOW = new Date('2026-01-01T00:00:00Z');
const FIVE_MIN_MS = 5 * 60 * 1000;

function config(challengeSecret: string | null): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://support.example.com',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/ailoom',
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ...(challengeSecret === null ? {} : { CHALLENGE_SECRET: challengeSecret }),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
  });
}

/** Solves a challenge like the ALTCHA widget does and encodes the payload it would send. */
async function solvedPayload(service: ChallengeService): Promise<string> {
  const challenge = await service.create();
  const solution = await solveChallenge(
    challenge.challenge,
    challenge.salt,
    challenge.algorithm,
    challenge.maxnumber,
  ).promise;
  if (solution === null) throw new Error('challenge was not solvable');
  return Buffer.from(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      number: solution.number,
      salt: challenge.salt,
      signature: challenge.signature,
    }),
  ).toString('base64');
}

// Solving a 50,000-number proof of work is CPU-bound; under the full parallel suite it can
// exceed Vitest's 5 s default without indicating a failure.
describe('ChallengeService', { timeout: 15_000 }, () => {
  it('creates an ALTCHA challenge signed with CHALLENGE_SECRET for 50 000 numbers', async () => {
    const service = new ChallengeService(config('c'.repeat(32)), new FixedClock(NOW));

    const challenge = await service.create();

    expect(challenge.algorithm).toBe('SHA-256');
    expect(challenge.maxnumber).toBe(50_000);
    expect(challenge.salt).toMatch(/^[0-9a-f]+\?expires=\d+&$/);
    expect(challenge.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies a payload the widget computes with solveChallenge', async () => {
    const service = new ChallengeService(config('c'.repeat(32)), new FixedClock(NOW));

    await expect(service.verify(await solvedPayload(service))).resolves.toBe(true);
  });

  it('rejects the same solution a second time (replay)', async () => {
    const service = new ChallengeService(config('c'.repeat(32)), new FixedClock(NOW));
    const payload = await solvedPayload(service);

    await expect(service.verify(payload)).resolves.toBe(true);
    await expect(service.verify(payload)).resolves.toBe(false);
  });

  it('rejects a payload whose challenge expired (clock + 6 min)', async () => {
    const clock = new FixedClock(NOW);
    const service = new ChallengeService(config('c'.repeat(32)), clock);
    const challenge = await service.create();

    clock.advance(FIVE_MIN_MS + 60_000);
    const solution = await solveChallenge(
      challenge.challenge,
      challenge.salt,
      challenge.algorithm,
      challenge.maxnumber,
    ).promise;
    if (solution === null) throw new Error('challenge was not solvable');
    const payload = Buffer.from(
      JSON.stringify({
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        number: solution.number,
        salt: challenge.salt,
        signature: challenge.signature,
      }),
    ).toString('base64');

    await expect(service.verify(payload)).resolves.toBe(false);
  });

  it('rejects a payload with a forged signature', async () => {
    const service = new ChallengeService(config('c'.repeat(32)), new FixedClock(NOW));
    const payload = await solvedPayload(service);
    const parsed = JSON.parse(Buffer.from(payload, 'base64').toString()) as { signature: string };
    // Flip the first signature character to one that cannot equal it.
    const tampered = parsed.signature.startsWith('0') ? '1' : '0';
    const forged = Buffer.from(
      JSON.stringify({ ...parsed, signature: `${tampered}${parsed.signature.slice(1)}` }),
    ).toString('base64');

    await expect(service.verify(forged)).resolves.toBe(false);
  });

  it('rejects a payload that is not a valid ALTCHA payload', async () => {
    const service = new ChallengeService(config('c'.repeat(32)), new FixedClock(NOW));

    await expect(service.verify('not-a-payload')).resolves.toBe(false);
  });

  it('refuses to create a challenge when CHALLENGE_SECRET is unset', () => {
    const service = new ChallengeService(config(null), new FixedClock(NOW));

    return expect(service.create()).rejects.toMatchObject({ code: 'internal_error' });
  });
});
