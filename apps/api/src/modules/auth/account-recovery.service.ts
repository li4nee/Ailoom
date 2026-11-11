// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { asUserId } from '../../db/ids';
import { EmailService } from '../email';
import { checkPassword } from './domain/password-policy';
import { EmailTokensService, VERIFY_EMAIL_TTL_HOURS } from './email-tokens.service';
import { PasswordHasher } from './password-hasher';
import type { Principal } from './principal';
import { SessionsService } from './sessions.service';
import { UsersRepository } from './users.repository';

/** Spec §9.1: verification links live a day, reset links an hour. */
const RESET_PASSWORD_TTL_HOURS = 1;

/**
 * Email verification and password recovery. `forgot-password` answers identically for every
 * address and queues nothing for an unknown one, so it cannot be used to enumerate accounts.
 */
@Injectable()
export class AccountRecoveryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersRepository,
    private readonly emailTokens: EmailTokensService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionsService,
    private readonly email: EmailService,
    private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AccountRecoveryService.name);
  }

  async verifyEmail(token: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.emailTokens.consume(token, 'verify_email', manager);
      if (row.userId === null) throw new AppError('invalid_token');
      await this.users.update(row.userId, { emailVerifiedAt: this.clock.now() }, manager);
    });
  }

  /** No-op when the address is already verified or email delivery is disabled. */
  async resendVerification(principal: Principal): Promise<void> {
    const user = await this.users.findById(principal.userId);
    if (user === null) throw new AppError('unauthorized');
    if (user.emailVerifiedAt !== null || !this.email.isEnabled()) return;

    const token = await this.emailTokens.issue(user.id, 'verify_email', VERIFY_EMAIL_TTL_HOURS);
    await this.email.send('verify_email', user.email, { name: user.name, token });
  }

  /** Always succeeds from the caller's point of view. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (user === null || !this.email.isEnabled()) return;

    const token = await this.emailTokens.issue(user.id, 'reset_password', RESET_PASSWORD_TTL_HOURS);
    await this.email.send('reset_password', user.email, { name: user.name, token });
    this.logger.info({ userId: user.id }, 'password reset email queued');
  }

  /**
   * Checks the password policy before spending the link, so a rejected password does not force
   * the user to request another email. Spending the token, writing the hash and revoking every
   * session commit together.
   */
  async resetPassword(token: string, password: string): Promise<void> {
    const peeked = await this.emailTokens.peek(token, 'reset_password');
    if (peeked.userId === null) throw new AppError('invalid_token');
    const user = await this.users.findById(peeked.userId);
    if (user === null) throw new AppError('invalid_token');

    const problems = checkPassword(password, { email: user.email });
    if (problems.length > 0) {
      throw new AppError('password_policy', {
        details: problems.map((problem) => ({ path: 'password', message: problem })),
      });
    }

    const passwordHash = await this.hasher.hash(password);
    await this.dataSource.transaction(async (manager) => {
      await this.emailTokens.consume(token, 'reset_password', manager);
      await this.users.update(user.id, { passwordHash }, manager);
      await this.sessions.revokeAllForUser(asUserId(user.id), 'password_change', manager);
    });
  }
}
