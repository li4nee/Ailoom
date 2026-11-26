// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import {
  testRetrievalSchema,
  type TestRetrievalResponse,
  type TestRetrievalRequest,
} from '@app/shared';

import { AppError } from '../../common/errors';
import { asBotId, asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, type Principal } from '../auth';
import { BotsService } from '../bots';
import { RetrievalService, selectUsedChunks } from './retrieval.service';

/**
 * Spec §13.3: the admin types a question and sees the scored chunks, so the threshold can be
 * tuned against real data. Uses the same retrieval and selection rule as chat answers.
 */
@Controller('v1/workspaces/:workspaceId/bots/:botId')
export class TestRetrievalController {
  constructor(
    private readonly bots: BotsService,
    private readonly retrieval: RetrievalService,
  ) {}

  @Post('test-retrieval')
  @RequireRole('admin')
  @HttpCode(HttpStatus.OK)
  async test(
    @CurrentPrincipal() _principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Body() body: TestRetrievalRequest,
  ): Promise<TestRetrievalResponse> {
    // Membership is resolved before the body is validated, so a non-member always sees 404
    // rather than a validation error that would confirm the workspace exists.
    const bot = await this.bots.get(asWorkspaceId(workspaceId), asBotId(botId));

    const parsed = testRetrievalSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('validation_failed', {
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }

    const result = await this.retrieval.retrieve(
      asWorkspaceId(workspaceId),
      bot,
      parsed.data.query,
      new AbortController().signal,
      {
        ...(parsed.data.retrievalMode === undefined
          ? {}
          : { retrievalMode: parsed.data.retrievalMode }),
        ...(parsed.data.threshold === undefined ? {} : { threshold: parsed.data.threshold }),
      },
    );
    const threshold = parsed.data.threshold ?? bot.retrievalThreshold;
    const used = new Set(selectUsedChunks(result.chunks, threshold).map((chunk) => chunk.chunkId));

    return {
      embeddingModel: bot.embeddingModel,
      retrievalMode: result.retrievalMode,
      threshold,
      results: result.chunks.map((chunk) => ({
        rank: chunk.rank,
        score: chunk.score,
        vectorRank: chunk.vectorRank ?? null,
        keywordRank: chunk.keywordRank ?? null,
        fusionScore: chunk.fusionScore,
        used: used.has(chunk.chunkId),
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        title: chunk.title,
        url: chunk.url,
        headingPath: chunk.headingPath,
        preview: chunk.content.slice(0, 300),
      })),
    };
  }
}
