// SPDX-License-Identifier: AGPL-3.0-only
import { Global, Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { SIGNUP_SETTINGS } from '../auth';
import { InstanceSettingsRepository } from './instance-settings.repository';
import { InstanceSettingsService } from './instance-settings.service';

/**
 * Instance-wide settings. Global so auth can inject the `SIGNUP_SETTINGS` port without
 * importing this module (which imports auth's user entity and would close a cycle).
 */
@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    InstanceSettingsRepository,
    InstanceSettingsService,
    { provide: SIGNUP_SETTINGS, useExisting: InstanceSettingsService },
  ],
  exports: [InstanceSettingsService, SIGNUP_SETTINGS],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class InstanceModule {}
