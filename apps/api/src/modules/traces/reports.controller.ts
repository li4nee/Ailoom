// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, Param, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { FeedbackItem, KnowledgeGapsReport, Page, UnansweredItem } from '@app/shared';
import { feedbackQuerySchema, knowledgeGapsQuerySchema, unansweredQuerySchema } from '@app/shared';

import { asWorkspaceId } from '../../db/ids';
import { RequireRole } from '../auth';
import { TracesService } from './traces.service';

class UnansweredQueryDto extends createZodDto(unansweredQuerySchema) {}
class FeedbackQueryDto extends createZodDto(feedbackQuerySchema) {}
class KnowledgeGapsQueryDto extends createZodDto(knowledgeGapsQuerySchema) {}

/** The admin quality reports of spec §17.10. */
@RequireRole('admin')
@Controller('v1/workspaces/:workspaceId')
export class ReportsController {
  constructor(private readonly traces: TracesService) {}

  @Get('unanswered')
  async unanswered(
    @Param('workspaceId') workspaceId: string,
    @Query() query: UnansweredQueryDto,
  ): Promise<Page<UnansweredItem>> {
    return this.traces.unanswered(asWorkspaceId(workspaceId), query);
  }

  @Get('feedback')
  async feedback(
    @Param('workspaceId') workspaceId: string,
    @Query() query: FeedbackQueryDto,
  ): Promise<Page<FeedbackItem>> {
    return this.traces.feedback(asWorkspaceId(workspaceId), query);
  }

  @Get('knowledge-gaps')
  async knowledgeGaps(
    @Param('workspaceId') workspaceId: string,
    @Query() query: KnowledgeGapsQueryDto,
  ): Promise<KnowledgeGapsReport> {
    return this.traces.knowledgeGaps(asWorkspaceId(workspaceId), query);
  }
}
