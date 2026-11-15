// SPDX-License-Identifier: AGPL-3.0-only
import { Global, Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { AuditModule } from '../audit';
import { SIGNUP_SETTINGS } from '../auth';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';
import { InstanceSettingsRepository } from './instance-settings.repository';
import { InstanceSettingsService } from './instance-settings.service';
import { InstanceController } from './instance.controller';

/**
 * Instance-wide settings. Global so auth can inject the `SIGNUP_SETTINGS` port without
 * importing this module (which imports auth's user entity and would close a cycle).
 */
@Global()
@Module({
  imports: [AuditModule],
  controllers: [InstanceController, DiagnosticsController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    DiagnosticsService,
    InstanceSettingsRepository,
    InstanceSettingsService,
    { provide: SIGNUP_SETTINGS, useExisting: InstanceSettingsService },
  ],
  exports: [InstanceSettingsService, SIGNUP_SETTINGS],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class InstanceModule {}
