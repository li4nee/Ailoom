// SPDX-License-Identifier: AGPL-3.0-only
import { Global, Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { AuditModule } from '../audit';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysRepository } from './api-keys.repository';
import { ApiKeysService } from './api-keys.service';

/** Workspace API keys are global so the access guard can authenticate them before feature routes run. */
@Global()
@Module({
  imports: [AuditModule],
  controllers: [ApiKeysController],
  providers: [{ provide: Clock, useClass: SystemClock }, ApiKeysRepository, ApiKeysService],
  exports: [ApiKeysRepository, ApiKeysService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class ApiKeysModule {}
