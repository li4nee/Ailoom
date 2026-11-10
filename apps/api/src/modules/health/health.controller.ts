// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { NodeResponse } from '@nestjs/platform-node';

import { Public } from '../auth';
import { HealthService, type Readiness } from './health.service';

/** Liveness and readiness run before anyone can sign in, and leak nothing about accounts. */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness only: the process is up and Nest can route a request. Readiness is separate. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: database reachable, migrations current, pg-boss installed, pgvector >= 0.8. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: NodeResponse): Promise<Readiness> {
    const readiness = await this.health.ready();
    if (readiness.status !== 'ok') response.statusCode = HttpStatus.SERVICE_UNAVAILABLE;
    return readiness;
  }
}
