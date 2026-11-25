// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import {
  createEvalDatasetSchema,
  evalCaseInputSchema,
  pageQuerySchema,
  updateEvalCaseSchema,
  updateEvalDatasetSchema,
} from '@app/shared';

import { AppError } from '../../common/errors';
import { asBotId, asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, SessionOnly, type Principal } from '../auth';
import { DatasetsService } from './datasets.service';

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
export class DatasetsController {
  constructor(private readonly datasets: DatasetsService) {}

  @Get('datasets')
  @RequireRole('agent')
  list(@Param('workspaceId') workspaceId: string, @Param('botId') botId: string) {
    return this.datasets.list(asWorkspaceId(workspaceId), asBotId(botId));
  }

  @Post('datasets')
  @RequireRole('admin')
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Body() body: unknown,
  ) {
    return this.datasets.create(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      principal.userId,
      parse(createEvalDatasetSchema, body),
    );
  }

  @Patch('datasets/:datasetId')
  @RequireRole('admin')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('datasetId') datasetId: string,
    @Body() body: unknown,
  ) {
    return this.datasets.update(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      datasetId,
      principal.userId,
      parse(updateEvalDatasetSchema, body),
    );
  }

  @Delete('datasets/:datasetId')
  @RequireRole('admin')
  delete(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('datasetId') datasetId: string,
  ) {
    return this.datasets.delete(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      datasetId,
      principal.userId,
    );
  }

  @Get('datasets/:datasetId/cases')
  @RequireRole('agent')
  listCases(
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('datasetId') datasetId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const page = parse(pageQuerySchema, query);
    return this.datasets.listCases(asWorkspaceId(workspaceId), asBotId(botId), datasetId, {
      limit: page.limit,
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
    });
  }

  @Post('datasets/:datasetId/cases')
  @RequireRole('admin')
  async createCases(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('datasetId') datasetId: string,
    @Body() body: unknown,
  ) {
    const cases =
      typeof body === 'object' && body !== null && 'cases' in body
        ? parse(z.array(evalCaseInputSchema).min(1).max(100), body.cases)
        : [parse(evalCaseInputSchema, body)];
    return {
      data: await this.datasets.createCases(
        asWorkspaceId(workspaceId),
        asBotId(botId),
        datasetId,
        principal.userId,
        cases,
      ),
    };
  }

  @Patch('cases/:caseId')
  @RequireRole('admin')
  updateCase(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('caseId') caseId: string,
    @Body() body: unknown,
  ) {
    return this.datasets.updateCase(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      caseId,
      principal.userId,
      parse(updateEvalCaseSchema, body),
    );
  }

  @Delete('cases/:caseId')
  @RequireRole('admin')
  deleteCase(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('caseId') caseId: string,
  ) {
    return this.datasets.deleteCase(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      caseId,
      principal.userId,
    );
  }

  @Post('datasets/:datasetId/import')
  @RequireRole('admin')
  import(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('datasetId') datasetId: string,
    @Body() body: unknown,
  ) {
    return this.datasets.importDataset(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      datasetId,
      principal.userId,
      body,
    );
  }

  @Get('datasets/:datasetId/export')
  @RequireRole('agent')
  export(
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('datasetId') datasetId: string,
  ) {
    return this.datasets.exportDataset(asWorkspaceId(workspaceId), asBotId(botId), datasetId);
  }
}
