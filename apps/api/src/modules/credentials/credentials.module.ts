// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { SecretBox } from '../../common/crypto';
import { AuditModule } from '../audit';
import { CredentialsRepository } from './credentials.repository';
import { CredentialsService } from './credentials.service';

/**
 * Provider credentials. `SecretBox` is built from the configured key ring here rather than in a
 * global module: only this module (and the re-encryption job it hosts) holds secrets.
 */
@Module({
  imports: [AuditModule],
  providers: [
    CredentialsRepository,
    CredentialsService,
    { provide: Clock, useClass: SystemClock },
    {
      provide: SecretBox,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new SecretBox(config.encryptionKeys),
    },
  ],
  exports: [CredentialsRepository, CredentialsService, SecretBox],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class CredentialsModule {}
