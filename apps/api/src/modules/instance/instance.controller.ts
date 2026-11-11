// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Put } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { InstancePublicInfo, InstanceSettingsDto } from '@app/shared';
import { updateInstanceSettingsRequestSchema } from '@app/shared';

import { CurrentPrincipal, InstanceAdminOnly, Public } from '../auth';
import type { Principal } from '../auth';
import { InstanceSettingsService } from './instance-settings.service';

class UpdateInstanceSettingsDto extends createZodDto(updateInstanceSettingsRequestSchema) {}

/**
 * Instance-wide settings, for instance admins only (except the public info the signed-out
 * pages need). Being an instance admin grants nothing in workspaces: those routes still
 * require a membership.
 */
@Controller('v1/instance')
export class InstanceController {
  constructor(private readonly settings: InstanceSettingsService) {}

  @Public()
  @Get('public')
  async publicInfo(): Promise<InstancePublicInfo> {
    return this.settings.publicInfo();
  }

  @InstanceAdminOnly()
  @Get('settings')
  async get(): Promise<InstanceSettingsDto> {
    return this.settings.get();
  }

  @InstanceAdminOnly()
  @Put('settings')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Body() body: UpdateInstanceSettingsDto,
  ): Promise<InstanceSettingsDto> {
    return this.settings.changeSignupMode(body.signupMode, principal.userId);
  }
}
