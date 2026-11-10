// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { EmailTokenType } from '@app/shared';

import { Clock } from '../../common/clock';
import { randomToken, sha256Hex } from '../../common/crypto';
import { EmailTokensRepository, type EmailTokenStore } from './email-tokens.repository';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Issues the links sent by email (verification, and from Task 1.8 password reset). Only the
 * SHA-256 of a token is stored: a database leak must not hand out working links. Consumption
 * (Task 1.8) re-hashes the presented token and marks the row used.
 */
@Injectable()
export class EmailTokensService {
  constructor(
    @Inject(EmailTokensRepository) private readonly store: EmailTokenStore,
    private readonly clock: Clock,
  ) {}

  /** Creates a token valid for `ttlHours` and returns it; it cannot be recovered later. */
  async issue(
    userId: string | null,
    type: EmailTokenType,
    ttlHours: number,
    manager?: EntityManager,
  ): Promise<string> {
    const token = randomToken();
    await this.store.create(
      {
        userId,
        type,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(this.clock.now().getTime() + ttlHours * HOUR_MS),
      },
      manager,
    );
    return token;
  }
}
