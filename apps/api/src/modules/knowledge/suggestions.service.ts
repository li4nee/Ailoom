// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import type {
  AgentReview,
  ApproveSuggestionRequest,
  ApproveSuggestionResponse,
  KnowledgeSuggestionDto,
  KnowledgeSuggestionQuery,
  RejectSuggestionRequest,
  ReviewAnswerRequest,
  ReviewAnswerResponse,
} from '@app/shared';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import { asSourceId, type UserId, type WorkspaceId } from '../../db/ids';
import { notifyWorkspace } from '../realtime';
import { MembershipsRepository } from '../workspaces';
import type { KnowledgeSourceEntity } from './entities/knowledge-source.entity';
import { SourcesService } from './sources.service';
import { SUGGESTION_CREATED, SUGGESTION_REVIEWED } from './suggestions.events';
import { SuggestionsRepository } from './suggestions.repository';

@Injectable()
export class SuggestionsService {
  constructor(
    private readonly ds: DataSource,
    private readonly suggestions: SuggestionsRepository,
    private readonly sources: SourcesService,
    private readonly memberships: MembershipsRepository,
    private readonly clock: Clock,
    private readonly events: EventEmitter2,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
  ) {}

  async review(
    workspaceId: WorkspaceId,
    conversationId: string,
    messageId: string,
    actorUserId: UserId,
    input: ReviewAnswerRequest,
  ): Promise<ReviewAnswerResponse> {
    const result = await this.ds.transaction(async (manager) => {
      const roles = await this.memberships.lockRoles(workspaceId, [actorUserId], manager);
      if (!roles.has(actorUserId)) throw new AppError('not_found');

      const conversation = await this.suggestions.lockConversation(
        workspaceId,
        conversationId,
        manager,
      );
      if (conversation === null) throw new AppError('not_found');
      const message = await this.suggestions.lockMessage(
        workspaceId,
        conversationId,
        messageId,
        manager,
      );
      if (message === null) throw new AppError('not_found');
      if (message.role !== 'ai' || message.status !== 'complete') throw new AppError('conflict');

      const now = this.clock.now();
      let suggestion: KnowledgeSuggestionDto | null = null;
      let suggestionId: string | null = null;
      if (input.verdict === 'incorrect') {
        const existing = await this.suggestions.lockPendingForMessage(
          workspaceId,
          messageId,
          manager,
        );
        const row = await this.suggestions.savePending({
          workspaceId,
          botId: conversation.botId,
          messageId,
          conversationId,
          question: input.question,
          answer: input.answer,
          createdBy: actorUserId,
          now,
          existing,
          manager,
        });
        suggestion = await this.suggestions.getDto(workspaceId, row.id, manager);
        suggestionId = row.id;
      } else {
        await this.suggestions.deletePendingForMessage(workspaceId, messageId, manager);
      }

      const review: AgentReview = {
        verdict: input.verdict,
        correctedAnswer: input.verdict === 'incorrect' ? input.answer : null,
        reviewerId: actorUserId,
        reviewedAt: now.toISOString(),
        suggestionId,
      };
      await this.suggestions.updateReview(workspaceId, conversationId, messageId, review, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'knowledge.agent_answer_reviewed',
          targetType: 'message',
          targetId: messageId,
          metadata: { conversationId, verdict: input.verdict, suggestionId },
        },
        manager,
      );
      await notifyWorkspace(manager, workspaceId, {
        type: 'conversation.updated',
        conversationId,
        botId: conversation.botId,
        status: conversation.status,
      });
      return { review, suggestion, conversation, suggestionId };
    });

    if (result.suggestionId !== null) {
      this.events.emit(SUGGESTION_CREATED, {
        workspaceId,
        suggestionId: result.suggestionId,
        botId: result.conversation.botId,
        conversationId,
        actorUserId,
      });
    }
    return { review: result.review, suggestion: result.suggestion };
  }

  async list(
    workspaceId: WorkspaceId,
    query: KnowledgeSuggestionQuery,
  ): Promise<{ data: KnowledgeSuggestionDto[]; nextCursor: string | null }> {
    return this.suggestions.listSuggestions(workspaceId, query);
  }

  async approve(
    workspaceId: WorkspaceId,
    suggestionId: string,
    reviewerUserId: UserId,
    input: ApproveSuggestionRequest,
  ): Promise<ApproveSuggestionResponse> {
    const result = await this.ds.transaction(async (manager) => {
      const roles = await this.memberships.lockRoles(workspaceId, [reviewerUserId], manager);
      const role = roles.get(reviewerUserId);
      if (role === undefined) throw new AppError('not_found');
      if (role === 'agent') throw new AppError('forbidden');

      const suggestion = await this.suggestions.lockSuggestion(workspaceId, suggestionId, manager);
      if (suggestion === null) throw new AppError('not_found');
      if (suggestion.status === 'approved' && suggestion.sourceId !== null) {
        return {
          suggestionId: suggestion.id,
          sourceId: suggestion.sourceId,
          botId: suggestion.botId,
          conversationId: suggestion.conversationId,
          creatorUserId: suggestion.createdBy as UserId | null,
          idempotent: true as const,
        };
      }
      if (suggestion.status !== 'pending') throw new AppError('conflict');

      const bot = await this.suggestions.findBot(workspaceId, suggestion.botId, manager);
      if (bot?.deletedAt !== null) {
        throw new AppError('conflict', { message: 'The bot is no longer available.' });
      }
      const question = input.question ?? suggestion.question;
      const answer = input.answer ?? suggestion.answer;
      const title = input.title ?? `Correction: ${question.slice(0, 80)}`;
      let source: KnowledgeSourceEntity;
      try {
        source = await this.sources.create(
          workspaceId,
          suggestion.botId,
          { type: 'text', title, body: `Question: ${question}\n\nAnswer: ${answer}` },
          reviewerUserId,
          manager,
        );
      } catch (error) {
        if (error instanceof AppError && error.code === 'not_found') {
          throw new AppError('conflict', { message: 'The bot is no longer available.' });
        }
        throw error;
      }
      const now = this.clock.now();
      await this.suggestions.setDecision(
        workspaceId,
        suggestion.id,
        {
          status: 'approved',
          reviewedBy: reviewerUserId,
          reviewedAt: now,
          rejectReason: null,
          sourceId: source.id,
          question,
          answer,
        },
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: reviewerUserId,
          action: 'knowledge.suggestion_reviewed',
          targetType: 'knowledge_suggestion',
          targetId: suggestion.id,
          metadata: { status: 'approved', botId: suggestion.botId, sourceId: source.id },
        },
        manager,
      );
      return {
        suggestionId: suggestion.id,
        sourceId: source.id,
        botId: suggestion.botId,
        conversationId: suggestion.conversationId,
        creatorUserId: suggestion.createdBy as UserId | null,
        idempotent: false as const,
      };
    });

    if (!result.idempotent) {
      this.events.emit(SUGGESTION_REVIEWED, {
        workspaceId,
        suggestionId: result.suggestionId,
        botId: result.botId,
        conversationId: result.conversationId,
        actorUserId: reviewerUserId,
        creatorUserId: result.creatorUserId,
        reviewerUserId,
        status: 'approved',
      });
    }
    return {
      suggestion: await this.suggestions.getDto(workspaceId, result.suggestionId),
      sourceId: asSourceId(result.sourceId),
    };
  }

  async reject(
    workspaceId: WorkspaceId,
    suggestionId: string,
    reviewerUserId: UserId,
    input: RejectSuggestionRequest,
  ): Promise<KnowledgeSuggestionDto> {
    const result = await this.ds.transaction(async (manager) => {
      const roles = await this.memberships.lockRoles(workspaceId, [reviewerUserId], manager);
      const role = roles.get(reviewerUserId);
      if (role === undefined) throw new AppError('not_found');
      if (role === 'agent') throw new AppError('forbidden');
      const suggestion = await this.suggestions.lockSuggestion(workspaceId, suggestionId, manager);
      if (suggestion === null) throw new AppError('not_found');
      if (suggestion.status !== 'pending') throw new AppError('conflict');

      await this.suggestions.setDecision(
        workspaceId,
        suggestion.id,
        {
          status: 'rejected',
          reviewedBy: reviewerUserId,
          reviewedAt: this.clock.now(),
          rejectReason: input.reason ?? null,
        },
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: reviewerUserId,
          action: 'knowledge.suggestion_reviewed',
          targetType: 'knowledge_suggestion',
          targetId: suggestion.id,
          metadata: { status: 'rejected', botId: suggestion.botId },
        },
        manager,
      );
      return {
        suggestionId: suggestion.id,
        botId: suggestion.botId,
        conversationId: suggestion.conversationId,
        creatorUserId: suggestion.createdBy as UserId | null,
      };
    });

    this.events.emit(SUGGESTION_REVIEWED, {
      workspaceId,
      suggestionId: result.suggestionId,
      botId: result.botId,
      conversationId: result.conversationId,
      actorUserId: reviewerUserId,
      creatorUserId: result.creatorUserId,
      reviewerUserId,
      status: 'rejected',
    });
    return this.suggestions.getDto(workspaceId, result.suggestionId);
  }
}
