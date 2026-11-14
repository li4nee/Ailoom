// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { createChallenge, extractParams, verifySolution } from 'altcha-lib/v1';
import { type Challenge } from 'altcha-lib/v1/types';

import { Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';

/**
 * The proof-of-work budget per challenge (spec §10.4): solving takes ~0.5–1 s on a phone,
 * enough to make scripted session farming expensive without bothering real visitors.
 */
export const CHALLENGE_MAX_NUMBER = 50_000;

/** How long a challenge stays solvable after it was issued. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** A used solution stays remembered as long as its challenge could still be valid. */
const REPLAY_TTL_MS = 5 * 60 * 1000;

/** Cap on the in-memory replay guard; the oldest entry is evicted when it is full. */
const REPLAY_CAPACITY = 10_000;

/** The ALTCHA solution payload a widget submits: base64-encoded JSON of this shape. */
interface AltchaPayload {
  algorithm: string;
  challenge: string;
  number: number;
  salt: string;
  signature: string;
}

function decodePayload(payload: string): AltchaPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const fields = parsed as AltchaPayload;
    return typeof fields.algorithm === 'string' &&
      typeof fields.challenge === 'string' &&
      typeof fields.number === 'number' &&
      Number.isFinite(fields.number) &&
      typeof fields.salt === 'string' &&
      typeof fields.signature === 'string'
      ? fields
      : null;
  } catch {
    // Not base64, not JSON, or not an object: nothing an honest widget sends.
    return null;
  }
}

/**
 * Issues and verifies the self-hosted, ALTCHA-compatible proof-of-work challenges the widget
 * solves before a session is created (spec §10.4). Challenges are HMAC-signed with
 * `CHALLENGE_SECRET`, so a solution cannot be forged without it, and every challenge carries
 * an `expires` parameter inside its salt.
 *
 * Single-instance limitation (spec Phase 1): the replay guard is an in-memory LRU of used
 * signatures, so solutions verified by one API instance are not known to another. That is
 * acceptable while the api runs as a single instance; a multi-instance deployment needs a
 * shared store here.
 */
@Injectable()
export class ChallengeService {
  /** Signature → the clock time until which it must stay rejected. */
  private readonly used = new Map<string, number>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  /** A fresh challenge; the bot gate in `BotsService` makes a missing secret unreachable. */
  async create(): Promise<Challenge> {
    const secret = this.config.challengeSecret;
    if (secret === null) {
      // Only reachable if CHALLENGE_SECRET disappeared from the env while a bot still has
      // `require_challenge`: the bots service refuses to enable the flag without it.
      throw new AppError('internal_error', { message: 'CHALLENGE_SECRET is not configured.' });
    }
    return createChallenge({
      hmacKey: secret.toString('hex'),
      maxNumber: CHALLENGE_MAX_NUMBER,
      expires: new Date(this.clock.now().getTime() + CHALLENGE_TTL_MS),
    });
  }

  /**
   * Verifies a submitted solution: not expired, never used before, and correctly signed.
   * Expiry is checked against the injected `Clock` because altcha-lib's own expiry check
   * compares against the real wall time, which tests cannot move.
   */
  async verify(payload: string): Promise<boolean> {
    const secret = this.config.challengeSecret;
    if (secret === null) return false;

    const decoded = decodePayload(payload);
    if (decoded === null || this.expired(decoded.salt) || this.replayed(decoded.signature)) {
      return false;
    }

    // The expiry check is done above; `checkExpires: false` skips altcha-lib's wall-time one.
    if (!(await verifySolution(payload, secret.toString('hex'), false))) return false;
    this.remember(decoded.signature);
    return true;
  }

  /** A challenge without an `expires` parameter never expires (altcha-lib semantics). */
  private expired(salt: string): boolean {
    const parameters = new URLSearchParams(salt.split('?')[1] ?? '');
    const raw = parameters.get('expires') ?? parameters.get('expire');
    if (raw === null) return false;
    const expires = Number.parseInt(raw, 10) * 1000;
    return Number.isNaN(expires) || expires < this.clock.now().getTime();
  }

  private replayed(signature: string): boolean {
    const until = this.used.get(signature);
    return until !== undefined && until > this.clock.now().getTime();
  }

  private remember(signature: string): void {
    const now = this.clock.now().getTime();
    for (const [key, until] of this.used) {
      if (until <= now) this.used.delete(key);
    }
    // Re-insert so recency is refreshed: the eviction candidate is the oldest entry.
    this.used.delete(signature);
    this.used.set(signature, now + REPLAY_TTL_MS);
    if (this.used.size > REPLAY_CAPACITY) {
      const oldest = this.used.keys().next();
      if (oldest.value !== undefined) this.used.delete(oldest.value);
    }
  }
}

export { extractParams };
