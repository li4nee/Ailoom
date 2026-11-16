// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get } from '@nestjs/common';

import type { Diagnostics } from '@app/shared';

import { InstanceAdminOnly } from '../auth';
import { DiagnosticsService } from './diagnostics.service';

/** Instance-admin diagnostics; the dashboard shows every check with its fix. */
@InstanceAdminOnly()
@Controller('health/diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  @Get()
  async get(): Promise<Diagnostics> {
    return this.diagnostics.get();
  }
}
