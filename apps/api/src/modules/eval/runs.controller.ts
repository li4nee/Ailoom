// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';

import { evalGateSchema, pageQuerySchema, startEvalRunSchema } from '@app/shared';

import { AppError } from '../../common/errors';
import { asBotId, asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, SessionOnly, type Principal } from '../auth';
import { RunsService } from './runs.service';

const resultsQuerySchema = pageQuerySchema.extend({
  filter: z.enum(['all', 'failed', 'changed', 'regressed']).default('all'),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError('validation_failed', {
    details: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

@SessionOnly()
@Controller('v1/workspaces/:workspaceId/bots/:botId/eval')
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Post('runs')
  @RequireRole('admin')
  start(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Body() body: unknown,
  ) {
    return this.runs.start(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      principal.userId,
      parse(startEvalRunSchema, body),
    );
  }

  @Put('gate')
  @RequireRole('admin')
  setGate(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Body() body: unknown,
  ) {
    return this.runs.setGate(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      principal.userId,
      parse(evalGateSchema, body),
    );
  }

  @Get('runs')
  @RequireRole('agent')
  list(
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const page = parse(pageQuerySchema, query);
    const datasetId =
      query['datasetId'] === undefined ? undefined : parse(z.uuid(), query['datasetId']);
    return this.runs.list(asWorkspaceId(workspaceId), asBotId(botId), {
      limit: page.limit,
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
      ...(datasetId === undefined ? {} : { datasetId }),
    });
  }

  @Get('runs/:runId')
  @RequireRole('agent')
  get(
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('runId') runId: string,
  ) {
    return this.runs.get(asWorkspaceId(workspaceId), asBotId(botId), runId);
  }

  @Get('runs/:runId/results')
  @RequireRole('agent')
  results(
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('runId') runId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = parse(resultsQuerySchema, query);
    return this.runs.results(asWorkspaceId(workspaceId), asBotId(botId), runId, {
      limit: parsed.limit,
      filter: parsed.filter,
      ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
    });
  }

  @Post('runs/:runId/cancel')
  @RequireRole('admin')
  cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('runId') runId: string,
  ) {
    return this.runs.cancel(asWorkspaceId(workspaceId), asBotId(botId), runId, principal.userId);
  }
}
