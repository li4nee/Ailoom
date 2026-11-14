// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { NodeResponse } from '@nestjs/platform-node';

import { Public } from '../../modules/auth';
import { ChallengeService } from './challenge.service';
import { CurrentVisitor } from './current-visitor.decorator';
import { type CurrentVisitorData } from './widget-rate-limits';

/**
 * `GET /api/widget/v1/challenge?k=...` (spec §10.4): issues a fresh HMAC-signed ALTCHA
 * challenge for bots that require proof of work, or answers 204 No Content when the bot does
 * not. The visitor guard has already resolved the bot and checked the page origin.
 */
@Public()
@Controller('widget/v1/challenge')
export class ChallengeController {
  constructor(private readonly challenge: ChallengeService) {}

  @Get()
  async get(
    @CurrentVisitor() visitor: CurrentVisitorData,
    @Res({ passthrough: true }) response: NodeResponse,
  ): Promise<unknown> {
    if (!visitor.bot.requireChallenge) {
      response.statusCode = HttpStatus.NO_CONTENT;
      return undefined;
    }
    return this.challenge.create();
  }
}
