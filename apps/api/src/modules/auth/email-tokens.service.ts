// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { EmailTokenType } from '@app/shared';

import { Clock } from '../../common/clock';
import { randomToken, sha256Hex } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { EmailTokensRepository, type EmailTokenStore } from './email-tokens.repository';
import type { EmailTokenEntity } from './entities/email-token.entity';

/** One value for the signup email and the resend link, so they cannot expire differently. */
export const VERIFY_EMAIL_TTL_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Issues the links sent by email (verification, password reset). Only the SHA-256 of a token
 * is stored: a database leak must not hand out working links. Consumption is single-use and
 * transactional, so two requests cannot both spend the same link.
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

  /** Reads a token without spending it (the reset flow checks the password policy first). */
  async peek(token: string, type: EmailTokenType): Promise<EmailTokenEntity> {
    const row = await this.store.findByHash(sha256Hex(token));
    if (row?.type !== type || row.usedAt !== null) throw new AppError('invalid_token');
    if (row.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new AppError('token_expired');
    }
    return row;
  }

  /** Spends a token; the returned row names its user. */
  async consume(
    token: string,
    type: EmailTokenType,
    manager?: EntityManager,
  ): Promise<EmailTokenEntity> {
    const result = await this.store.consume(sha256Hex(token), type, this.clock.now(), manager);
    if (result.kind === 'invalid') throw new AppError('invalid_token');
    if (result.kind === 'expired') throw new AppError('token_expired');
    return result.token;
  }
}
