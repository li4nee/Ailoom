// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { CredentialsModule } from './credentials.module';
import { ReencryptProcessor } from './reencrypt.processor';

/**
 * The worker half of master-key rotation, kept out of the api graph: only the worker runs
 * jobs, and the processor needs `SecretBox`, which `CredentialsModule` exports.
 */
@Module({ imports: [CredentialsModule], providers: [ReencryptProcessor] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class CredentialsReencryptModule {}
