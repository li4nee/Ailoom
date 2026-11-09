// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get } from '@nestjs/common';

/** Liveness only: the process is up and Nest can route a request. Readiness is separate. */
@Controller('health')
export class HealthController {
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
