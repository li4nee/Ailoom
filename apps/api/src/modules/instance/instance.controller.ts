// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Put } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { InstanceSettingsDto } from '@app/shared';
import { updateInstanceSettingsRequestSchema } from '@app/shared';

import { CurrentPrincipal, InstanceAdminOnly } from '../auth';
import type { Principal } from '../auth';
import { InstanceSettingsService } from './instance-settings.service';

class UpdateInstanceSettingsDto extends createZodDto(updateInstanceSettingsRequestSchema) {}

/**
 * Instance-wide settings, for instance admins only. Being an instance admin grants nothing in
 * workspaces: those routes still require a membership.
 */
@InstanceAdminOnly()
@Controller('v1/instance')
export class InstanceController {
  constructor(private readonly settings: InstanceSettingsService) {}

  @Get('settings')
  async get(): Promise<InstanceSettingsDto> {
    return this.settings.get();
  }

  @Put('settings')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Body() body: UpdateInstanceSettingsDto,
  ): Promise<InstanceSettingsDto> {
    return this.settings.changeSignupMode(body.signupMode, principal.userId);
  }
}
