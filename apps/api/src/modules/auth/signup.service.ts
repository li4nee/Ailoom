// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';

import type { SignupRequest } from '@app/shared';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { EmailService } from '../email';
import { checkPassword } from './domain/password-policy';
import { EmailTokensService, VERIFY_EMAIL_TTL_HOURS } from './email-tokens.service';
import { UserEntity } from './entities/user.entity';
import { PasswordHasher } from './password-hasher';
import {
  INVITATION_ACCEPTANCE,
  SIGNUP_SETTINGS,
  type InvitationAcceptance,
  type SignupSettings,
} from './ports';
import { UsersRepository } from './users.repository';

/** Verification links live for a day (spec §9.1). */

/**
 * The signup use case (spec §10.1): signup mode, the first-user exception, invite acceptance
 * and the verification email. The whole write side runs in one transaction: a user is never
 * created without the membership their invitation granted, nor without the token/email that
 * lets them verify.
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly hasher: PasswordHasher,
    private readonly users: UsersRepository,
    private readonly emailTokens: EmailTokensService,
    private readonly email: EmailService,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    @Inject(SIGNUP_SETTINGS) private readonly settings: SignupSettings,
    @Inject(INVITATION_ACCEPTANCE) private readonly invitations: InvitationAcceptance,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SignupService.name);
  }

  async signup(input: SignupRequest, meta: { ip: string; userAgent: string }): Promise<UserEntity> {
    const email = input.email.trim();
    const problems = checkPassword(input.password, { email });
    if (problems.length > 0) {
      throw new AppError('password_policy', {
        details: problems.map((problem) => ({ path: 'password', message: problem })),
      });
    }

    // Hashing is deliberately outside the transaction: it is slow and holds no locks.
    const passwordHash = await this.hasher.hash(input.password);
    const mode = await this.settings.getSignupMode();

    return this.dataSource.transaction(async (manager) => {
      // Only an empty table can produce a first user, so only then is the lock taken. The
      // advisory lock is held until commit, and the re-count runs after the winner commits,
      // so exactly one concurrent first signup sees zero users and becomes instance admin.
      let isFirstUser = (await this.users.count(manager)) === 0;
      if (isFirstUser) {
        await this.users.lockForFirstUser(manager);
        isFirstUser = (await this.users.count(manager)) === 0;
      }
      if (!isFirstUser) {
        if (mode === 'closed') throw new AppError('signup_closed');
        if (mode === 'invite' && input.invitationToken === undefined) {
          throw new AppError('invitation_required');
        }
      }
      if ((await this.users.findByEmail(email)) !== null) throw new AppError('email_taken');

      const invitation =
        !isFirstUser && input.invitationToken !== undefined
          ? await this.invitations.findValidForSignup(input.invitationToken, email, manager)
          : null;

      const emailEnabled = this.email.isEnabled();
      const user = await this.users.insert(
        {
          email,
          passwordHash,
          name: input.name ?? null,
          isInstanceAdmin: isFirstUser,
          emailVerifiedAt: emailEnabled ? null : this.clock.now(),
        },
        manager,
      );

      if (invitation !== null) {
        await this.invitations.acceptForSignup(invitation, user.id, manager);
      }

      if (emailEnabled) {
        const token = await this.emailTokens.issue(
          user.id,
          'verify_email',
          VERIFY_EMAIL_TTL_HOURS,
          manager,
        );
        await this.email.send('verify_email', email, { name: user.name, token }, { manager });
      }

      this.logger.info({ userId: user.id, ip: meta.ip }, 'user signed up');
      return user;
    });
  }
}
