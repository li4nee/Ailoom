// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

import { HealthService, type HealthCheckResult } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness only: the process is up and Nest can route a request. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: all dependencies are healthy and migrations are applied. */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready(): Promise<HealthCheckResult> {
    return this.health.checkReadiness();
  }
}
