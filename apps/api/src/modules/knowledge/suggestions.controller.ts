// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  approveSuggestionSchema,
  knowledgeSuggestionQuerySchema,
  rejectSuggestionSchema,
  reviewAnswerSchema,
  type ApproveSuggestionResponse,
  type KnowledgeSuggestionDto,
  type Page,
  type ReviewAnswerResponse,
} from '@app/shared';

import { AppError } from '../../common/errors';
import { asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, SessionOnly, type Principal } from '../auth';
import { SuggestionsService } from './suggestions.service';

const reviewAnswerDtoSchema = z.object({
  verdict: z.enum(['correct', 'incorrect']),
  question: z.string().optional(),
  answer: z.string().optional(),
});
class ReviewAnswerDto extends createZodDto(reviewAnswerDtoSchema) {}
class KnowledgeSuggestionQueryDto extends createZodDto(knowledgeSuggestionQuerySchema) {}
class ApproveSuggestionDto extends createZodDto(approveSuggestionSchema) {}
class RejectSuggestionDto extends createZodDto(rejectSuggestionSchema) {}

@SessionOnly()
@Controller('v1/workspaces/:workspaceId')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Post('conversations/:conversationId/messages/:messageId/review')
  @RequireRole('agent')
  review(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() body: ReviewAnswerDto,
  ): Promise<ReviewAnswerResponse> {
    const parsed = reviewAnswerSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('validation_failed', {
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
    return this.suggestions.review(
      this.workspaceOf(principal),
      conversationId,
      messageId,
      principal.userId,
      parsed.data,
    );
  }

  @Get('knowledge/suggestions')
  @RequireRole('agent')
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: KnowledgeSuggestionQueryDto,
  ): Promise<Page<KnowledgeSuggestionDto>> {
    return this.suggestions.list(this.workspaceOf(principal), query);
  }

  @Post('knowledge/suggestions/:suggestionId/approve')
  @RequireRole('admin')
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('suggestionId') suggestionId: string,
    @Body() body: ApproveSuggestionDto,
  ): Promise<ApproveSuggestionResponse> {
    return this.suggestions.approve(
      this.workspaceOf(principal),
      suggestionId,
      principal.userId,
      body,
    );
  }

  @Post('knowledge/suggestions/:suggestionId/reject')
  @RequireRole('admin')
  reject(
    @CurrentPrincipal() principal: Principal,
    @Param('suggestionId') suggestionId: string,
    @Body() body: RejectSuggestionDto,
  ): Promise<{ suggestion: KnowledgeSuggestionDto }> {
    return this.suggestions
      .reject(this.workspaceOf(principal), suggestionId, principal.userId, body)
      .then((suggestion) => ({ suggestion }));
  }

  private workspaceOf(principal: Principal) {
    const workspaceId = principal.workspace?.id;
    if (workspaceId === undefined) throw new AppError('not_found');
    return asWorkspaceId(workspaceId);
  }
}
