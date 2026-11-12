// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { SecretBox } from '../../common/crypto';
import { CREDENTIAL_STATUS } from '../../providers/types';
import { AuditModule } from '../audit';
import { CredentialsRepository } from './credentials.repository';
import { CredentialsService } from './credentials.service';
import { LocalCredentialListener } from './local-credential.listener';

/**
 * Provider credentials. `SecretBox` is built from the configured key ring here rather than in a
 * global module: only this module (and the re-encryption job it hosts) holds secrets.
 */
@Module({
  imports: [AuditModule],
  // No controllers: they need `ProviderOps`, which lives in the model layer, and that layer
  // already imports this module for its credential resolver. The HTTP app registers them.
  providers: [
    CredentialsRepository,
    CredentialsService,
    // Provisions the workspace's built-in `local` credential on `workspace.created`.
    LocalCredentialListener,
    // The provider layer records a probe's outcome through a narrow port, not this module.
    { provide: CREDENTIAL_STATUS, useExisting: CredentialsService },
    { provide: Clock, useClass: SystemClock },
    {
      provide: SecretBox,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new SecretBox(config.encryptionKeys),
    },
  ],
  exports: [
    CREDENTIAL_STATUS,
    CredentialsRepository,
    CredentialsService,
    LocalCredentialListener,
    SecretBox,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class CredentialsModule {}
