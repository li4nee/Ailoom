// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { SIGNUP_MODES, type SignupMode } from '@app/shared';

import { Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import type { UserId } from '../../db/ids';
import type { SignupSettings } from '../auth';
import { InstanceSettingsRepository } from './instance-settings.repository';

/** The one instance setting today; later milestones add keys here. */
export const SIGNUP_MODE_KEY = 'signup_mode';

const signupModeValue = z.enum(SIGNUP_MODES);

/**
 * Instance-wide switches. A stored row overrides the environment; without one the validated
 * `AppConfig` value applies. A corrupt row falls back to the environment instead of failing
 * every signup, so a bad write cannot lock the instance.
 */
@Injectable()
export class InstanceSettingsService implements SignupSettings {
  constructor(
    private readonly settings: InstanceSettingsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async getSignupMode(): Promise<SignupMode> {
    const row = await this.settings.find(SIGNUP_MODE_KEY);
    if (row === null) return this.config.signupMode;
    const parsed = signupModeValue.safeParse(row.value);
    return parsed.success ? parsed.data : this.config.signupMode;
  }

  async setSignupMode(mode: SignupMode, byUserId: UserId | null): Promise<void> {
    await this.settings.set(SIGNUP_MODE_KEY, mode, byUserId, this.clock.now());
  }
}
