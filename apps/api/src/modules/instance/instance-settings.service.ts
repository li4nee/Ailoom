// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { z } from 'zod';

import {
  SIGNUP_MODES,
  type InstancePublicInfo,
  type InstanceSettingsDto,
  type SignupMode,
} from '@app/shared';

import { Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
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
    private readonly ds: DataSource,
    private readonly settings: InstanceSettingsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {}

  async getSignupMode(): Promise<SignupMode> {
    return (await this.resolveSignupMode()).mode;
  }

  /** What the instance settings page shows (spec §17.2 instance routes). */
  async get(): Promise<InstanceSettingsDto> {
    const { mode, source } = await this.resolveSignupMode();
    return {
      signupMode: mode,
      signupModeSource: source,
      emailEnabled: this.config.email.transport !== 'none',
    };
  }

  /** For the signed-out pages: whether signup is possible and if the next user is the first. */
  async publicInfo(): Promise<InstancePublicInfo> {
    return {
      signupMode: await this.getSignupMode(),
      firstUser: !(await this.settings.hasUsers()),
      emailEnabled: this.config.email.transport !== 'none',
    };
  }

  /** An instance admin's change: stored as an override and audited with no workspace. */
  async changeSignupMode(mode: SignupMode, actorId: UserId): Promise<InstanceSettingsDto> {
    const previous = await this.getSignupMode();
    await this.ds.transaction(async (manager) => {
      await this.settings.set(SIGNUP_MODE_KEY, mode, actorId, this.clock.now(), manager);
      await this.audit.record(
        {
          workspaceId: null,
          actorUserId: actorId,
          action: 'instance.signup_mode_changed',
          targetType: 'instance',
          targetId: null,
          metadata: { from: previous, to: mode },
        },
        manager,
      );
    });
    return this.get();
  }

  /** A corrupt stored value counts as no override, so the env value and source apply. */
  private async resolveSignupMode(): Promise<{ mode: SignupMode; source: 'env' | 'override' }> {
    const row = await this.settings.find(SIGNUP_MODE_KEY);
    const parsed = row === null ? null : signupModeValue.safeParse(row.value);
    return parsed?.success === true
      ? { mode: parsed.data, source: 'override' }
      : { mode: this.config.signupMode, source: 'env' };
  }

  async setSignupMode(mode: SignupMode, byUserId: UserId | null): Promise<void> {
    await this.settings.set(SIGNUP_MODE_KEY, mode, byUserId, this.clock.now());
  }
}
