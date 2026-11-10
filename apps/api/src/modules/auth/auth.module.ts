// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { AccessRepository } from './access.repository';
import { AccountRecoveryService } from './account-recovery.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailTokensRepository } from './email-tokens.repository';
import { EmailTokensService } from './email-tokens.service';
import { PasswordHasher } from './password-hasher';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';
import { SignupService } from './signup.service';
import { TokenService } from './token.service';
import { UsersRepository } from './users.repository';

/**
 * The auth HTTP surface. `TokenService` and `AccessRepository` are exported because the global
 * `AccessGuard` in `HttpAppModule` uses them on every request.
 */
@Module({
  controllers: [AuthController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    AccessRepository,
    AccountRecoveryService,
    AuthService,
    EmailTokensRepository,
    EmailTokensService,
    PasswordHasher,
    SessionsRepository,
    SessionsService,
    SignupService,
    TokenService,
    UsersRepository,
  ],
  exports: [AccessRepository, TokenService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class AuthModule {}
