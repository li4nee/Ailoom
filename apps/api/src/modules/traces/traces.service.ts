// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';

import type {
  FeedbackItem,
  FeedbackQuery,
  KnowledgeGapsQuery,
  KnowledgeGapsReport,
  Page,
  ProviderKind,
  TraceDetail,
  UnansweredItem,
  UnansweredQuery,
} from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { PricingService } from '../usage';
import { toTraceDetail } from './traces.mapper';
import { TracesRepository, type TraceDetailRow } from './traces.repository';

/** Read-side of the replay drawer (spec §17.8). Every lookup is workspace-scoped. */
@Injectable()
export class TracesService {
  constructor(
    private readonly traces: TracesRepository,
    private readonly pricing: PricingService,
  ) {}

  async get(workspaceId: WorkspaceId, traceId: string): Promise<TraceDetail> {
    const row = await this.traces.detail(workspaceId, traceId);
    if (row === null) throw new AppError('not_found');
    return this.toDetail(workspaceId, row);
  }

  /** The unanswered-questions report (spec §17.10), newest first. */
  async unanswered(
    workspaceId: WorkspaceId,
    query: UnansweredQuery,
  ): Promise<Page<UnansweredItem>> {
    const page = await this.traces.unanswered(workspaceId, {
      botId: query.botId,
      cursor: query.cursor,
      limit: query.limit,
    });
    return {
      data: page.data.map((row) => ({
        messageId: row.message_id,
        conversationId: row.conversation_id,
        botId: row.bot_id,
        content: row.content,
        topScore: row.top_score,
        createdAt: row.created_at.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async knowledgeGaps(
    workspaceId: WorkspaceId,
    query: KnowledgeGapsQuery,
  ): Promise<KnowledgeGapsReport> {
    if (query.botId !== undefined && !(await this.traces.assertBot(workspaceId, query.botId))) {
      throw new AppError('not_found');
    }
    const from = new Date(`${query.from}T00:00:00.000Z`);
    const toExclusive = new Date(Date.parse(`${query.to}T00:00:00.000Z`) + 86_400_000);
    const report = await this.traces.knowledgeGaps(workspaceId, from, toExclusive, query.botId);
    return {
      totalMessages: report.total.total_messages,
      totalGroups: report.total.total_groups,
      groups: report.groups.map((row) => ({
        botId: row.bot_id,
        botName: row.bot_name,
        wording: row.wording,
        occurrences: row.occurrences,
        conversations: row.conversations,
        lastSeen: row.last_seen.toISOString(),
        daily: row.daily,
        examples: row.examples.map((example) => ({
          messageId: example.message_id,
          conversationId: example.conversation_id,
          content: example.content,
          createdAt: new Date(example.created_at).toISOString(),
        })),
      })),
    };
  }

  /** The negative-feedback report (spec §17.10). */
  async feedback(workspaceId: WorkspaceId, query: FeedbackQuery): Promise<Page<FeedbackItem>> {
    const page = await this.traces.feedback(workspaceId, {
      rating: query.rating,
      botId: query.botId,
      cursor: query.cursor,
      limit: query.limit,
    });
    return {
      data: page.data.map((row) => ({
        messageId: row.message_id,
        conversationId: row.conversation_id,
        content: row.content,
        traceId: row.trace_id,
        feedbackAt: row.feedback_at?.toISOString() ?? null,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async getForMessage(workspaceId: WorkspaceId, messageId: string): Promise<TraceDetail> {
    const trace = await this.traces.findByMessageId(workspaceId, messageId);
    if (trace === null) throw new AppError('not_found');
    return this.get(workspaceId, trace.id);
  }

  private async toDetail(workspaceId: WorkspaceId, row: TraceDetailRow): Promise<TraceDetail> {
    const retrieval = await this.traces.retrievalRows(workspaceId, row.id);
    const price = await this.pricing.cost(workspaceId, {
      ...(row.chat_provider === null || row.chat_model === null
        ? {}
        : {
            chat: {
              provider: row.chat_provider as ProviderKind,
              model: row.chat_model,
              inputTokens: row.input_tokens,
              outputTokens: row.output_tokens,
            },
          }),
      ...(row.embedding_provider === null || row.embedding_model === null
        ? {}
        : {
            embedding: {
              provider: row.embedding_provider as ProviderKind,
              model: row.embedding_model,
              tokens: row.embedding_tokens,
            },
          }),
    });
    return toTraceDetail(row, retrieval, price.priceKnown);
  }
}
