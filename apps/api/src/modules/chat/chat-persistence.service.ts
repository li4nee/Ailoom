// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Big from 'big.js';
import { DataSource } from 'typeorm';

import type {
  Citation,
  ConversationStatus,
  HandoffReason,
  ProviderKind,
  TraceDecision,
  TraceOrigin,
} from '@app/shared';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { newId } from '../../common/ids';
import type { UserId, WorkspaceId } from '../../db/ids';
import { JobsService } from '../../jobs';
import { BotsRepository } from '../bots';
import {
  ConversationsRepository,
  MessagesRepository,
  type ConversationEntity,
  type MessageCitation,
  type MessageEntity,
} from '../conversations';
import { OutboxService } from '../integrations';
import { NotificationsService } from '../notifications';
import { notifyWorkspace } from '../realtime';
import { TracesRepository } from '../traces';
import { SPEND_ALERTS_JOB, UsageRepository, PricingService, utcDay, utcMonthKey } from '../usage';
import { CHAT_HANDOFF_REQUESTED, type ChatHandoffRequestedEvent } from './events';

/** Spec §9.4: a conversation stops accepting messages at this many rows. */
export const CONVERSATION_MESSAGE_CAP = 200;

/** A streaming placeholder older than this is a dead stream, not an answer in flight. */
export const STREAM_STUCK_MS = 90_000;

export interface BeginTurnResult {
  visitorMessage: MessageEntity;
  /** Null when a human owns the conversation: the visitor message is stored, no AI reply. */
  aiMessageId: string | null;
  conversation: ConversationEntity;
}

export interface FinalizeInput {
  workspaceId: WorkspaceId;
  botId: string;
  conversationId: string | null;
  aiMessageId: string | null;
  triggerMessageId: string | null;
  origin: TraceOrigin;
  content: string;
  status: 'complete' | 'error';
  citations: Citation[];
  decision: TraceDecision;
  decisionReason: string | null;
  retrieval: {
    chunkId: string;
    score: number;
    rank: number;
    used: boolean;
    vectorRank?: number | null;
    keywordRank?: number | null;
    fusionScore?: number;
    originalRank?: number;
    rerankScore?: number;
  }[];
  retrievalMode?: 'vector' | 'hybrid';
  retrievalMs?: number | undefined;
  rerankingApplied?: boolean | undefined;
  rerankingMs?: number | undefined;
  rerankingFailure?: 'invalid_scores' | 'unavailable' | 'timeout' | null | undefined;
  retrievalCostUsd?: string | null | undefined;
  topScore: number | null;
  promptVersionId: string | null;
  platformPromptVersion: string;
  chat: {
    provider: ProviderKind;
    model: string;
    inputTokens: number;
    outputTokens: number;
  } | null;
  embedding: { provider: ProviderKind; model: string; tokens: number } | null;
  requestSnapshot: unknown;
  /** Tool names and field names only; raw visitor arguments and API results are never traced. */
  toolCalls?: {
    name: string;
    inputFields: string[];
    outputFields: string[];
    status: 'started' | 'complete' | 'failed';
    durationMs: number | null;
  }[];
  toolTurnId?: string;
  latencyMs: number;
  ttftMs: number | null;
  error: string | null;
  escalation: { setsNeedsHuman: boolean; reason: HandoffReason } | null;
}

export interface FinalizeResult {
  traceId: string;
  costUsd: string;
}

function toMessageCitation(citation: Citation): MessageCitation {
  return {
    n: citation.n,
    chunk_id: citation.chunkId,
    document_id: citation.documentId,
    title: citation.title,
    url: citation.url,
  };
}

function asSnapshot(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

/**
 * Persists one chat turn (spec §13.5, §9.5). `beginTurn` locks the conversation and creates the
 * visitor message plus the streaming AI placeholder; `finalize` writes the message, trace and
 * usage row in a single transaction, so a failed write never leaves a half-answered message.
 */
@Injectable()
export class ChatPersistence {
  constructor(
    private readonly ds: DataSource,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly traces: TracesRepository,
    private readonly usage: UsageRepository,
    private readonly pricing: PricingService,
    private readonly bots: BotsRepository,
    private readonly jobs: JobsService,
    private readonly events: EventEmitter2,
    private readonly clock: Clock,
    @Optional() private readonly outbox?: OutboxService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async beginTurn(
    workspaceId: WorkspaceId,
    conversationId: string,
    content: string,
  ): Promise<BeginTurnResult> {
    const now = this.clock.now();

    return this.ds.transaction(async (manager) => {
      const conversation = await this.conversations.lockForUpdate(
        workspaceId,
        conversationId,
        manager,
      );

      const since = new Date(now.getTime() - STREAM_STUCK_MS);
      const turnState = await this.messages.turnState(workspaceId, conversationId, since, manager);
      if (turnState.count >= CONVERSATION_MESSAGE_CAP) {
        throw new AppError('conversation_full');
      }
      if (turnState.hasStreaming) {
        throw new AppError('answer_in_progress');
      }

      const visitorMessage = await this.messages.insert(
        workspaceId,
        {
          conversationId,
          role: 'visitor',
          content,
          status: 'complete',
          createdAt: now,
        },
        manager,
      );

      let aiMessageId: string | null = null;
      if (conversation.status === 'ai') {
        aiMessageId = newId();
        await this.messages.insert(
          workspaceId,
          {
            id: aiMessageId,
            conversationId,
            role: 'ai',
            content: '',
            status: 'streaming',
            createdAt: now,
          },
          manager,
        );
      }

      const updated = await this.conversations.updateById(
        workspaceId,
        conversationId,
        { lastMessageAt: now },
        manager,
      );

      if (
        this.notifications !== undefined &&
        conversation.status === 'human' &&
        conversation.assignedUserId !== null
      ) {
        await this.notifications.notify(manager, {
          type: 'visitor_replied',
          workspaceId,
          conversationId,
          botId: conversation.botId,
          actorUserId: null,
          assigneeUserId: conversation.assignedUserId as UserId,
          preview: content.slice(0, 140),
          hasInternalNotes: false,
        });
      }

      // Spec §9.5: a visitor message is counted when it arrives, not when it is answered.
      await this.usage.increment(
        manager,
        { workspaceId, botId: conversation.botId, day: utcDay(now) },
        { visitorMessages: 1 },
      );
      // Inside the transaction: Postgres delivers it only if this commits (spec §18.3).
      await notifyWorkspace(manager, workspaceId, {
        type: 'message.created',
        conversationId,
        messageId: visitorMessage.id,
        role: 'visitor',
      });
      if (this.outbox !== undefined) {
        await this.outbox.record(
          workspaceId,
          {
            type: 'message.created',
            aggregateId: visitorMessage.id,
            idempotencyKey: `message:${visitorMessage.id}`,
            data: {
              conversationId,
              messageId: visitorMessage.id,
              role: 'visitor',
              status: visitorMessage.status,
            },
          },
          manager,
        );
      }

      return { visitorMessage, aiMessageId, conversation: updated };
    });
  }

  /**
   * Marks a turn that will never be finalized as an error (the bot or workspace is gone, or
   * the visitor disconnected). Writes no trace and no usage: nothing else is known.
   */
  async markMessageError(
    workspaceId: WorkspaceId,
    aiMessageId: string,
    content: string,
  ): Promise<void> {
    try {
      await this.messages.updateById(workspaceId, aiMessageId, {
        content,
        status: 'error',
      });
    } catch (error) {
      // A purged workspace has no message left to update; that is the expected outcome here.
      if (!(error instanceof AppError && error.code === 'not_found')) throw error;
    }
  }

  async finalize(input: FinalizeInput): Promise<FinalizeResult> {
    const now = this.clock.now();
    const cost = await this.pricing.costBreakdown(input.workspaceId, {
      ...(input.chat === null ? {} : { chat: input.chat }),
      ...(input.embedding === null ? {} : { embedding: input.embedding }),
    });
    const totalCost = cost.total;
    const retrievalCostUsd =
      input.retrievalCostUsd ?? (cost.embedding.priceKnown ? cost.embedding.costUsd : null);
    const traceId = newId();
    const handoff = input.escalation?.setsNeedsHuman === true && input.conversationId !== null;

    await this.ds.transaction(async (manager) => {
      if (input.aiMessageId !== null) {
        await this.messages.updateById(
          input.workspaceId,
          input.aiMessageId,
          {
            content: input.content,
            status: input.status,
            citations:
              input.citations.length === 0
                ? null
                : input.citations.map((citation) => toMessageCitation(citation)),
          },
          manager,
        );
      }

      await this.traces.insert(
        input.workspaceId,
        {
          id: traceId,
          botId: input.botId,
          conversationId: input.conversationId,
          messageId: input.aiMessageId,
          origin: input.origin,
          triggerMessageId: input.triggerMessageId,
          promptVersionId: input.promptVersionId,
          platformPromptVersion: input.platformPromptVersion,
          chatProvider: input.chat?.provider ?? null,
          chatModel: input.chat?.model ?? null,
          embeddingProvider: input.embedding?.provider ?? null,
          embeddingModel: input.embedding?.model ?? null,
          retrieval: input.retrieval.map((entry) => ({
            chunk_id: entry.chunkId,
            score: entry.score,
            rank: entry.rank,
            used: entry.used,
            ...(entry.vectorRank === undefined ? {} : { vector_rank: entry.vectorRank }),
            ...(entry.keywordRank === undefined ? {} : { keyword_rank: entry.keywordRank }),
            ...(entry.fusionScore === undefined ? {} : { fusion_score: entry.fusionScore }),
            ...(entry.originalRank === undefined ? {} : { original_rank: entry.originalRank }),
            ...(entry.rerankScore === undefined ? {} : { rerank_score: entry.rerankScore }),
          })),
          retrievalMode: input.retrievalMode ?? 'vector',
          retrievalMs: input.retrievalMs ?? null,
          rerankingApplied: input.rerankingApplied ?? false,
          rerankingMs: input.rerankingMs ?? 0,
          rerankingFailure: input.rerankingFailure ?? null,
          retrievalCostUsd,
          topScore: input.topScore,
          decision: input.decision,
          decisionReason: input.decisionReason,
          requestSnapshot: asSnapshot(input.requestSnapshot),
          toolCalls: input.toolCalls ?? [],
          inputTokens: input.chat?.inputTokens ?? 0,
          outputTokens: input.chat?.outputTokens ?? 0,
          embeddingTokens: input.embedding?.tokens ?? 0,
          costUsd: totalCost.costUsd,
          latencyMs: input.latencyMs,
          ttftMs: input.ttftMs,
          error: input.error,
        },
        manager,
      );
      if (input.toolTurnId !== undefined) {
        await manager.query(
          `UPDATE tool_invocations
              SET trace_id = $1
            WHERE workspace_id = $2 AND turn_id = $3`,
          [traceId, input.workspaceId, input.toolTurnId],
        );
      }

      let conversationStatus: ConversationStatus | null = null;
      if (input.conversationId !== null) {
        if (handoff) {
          const updated = await this.conversations.updateById(
            input.workspaceId,
            input.conversationId,
            {
              status: 'needs_human',
              workflowVersion: () => '"workflow_version" + 1',
              handoffReason: input.escalation?.reason ?? null,
              handoffRequestedAt: now,
            },
            manager,
          );
          conversationStatus = updated.status;
        } else {
          const row = await this.conversations.findById(
            input.workspaceId,
            input.conversationId,
            manager,
          );
          conversationStatus = row?.status ?? null;
        }
      }

      await this.usage.increment(
        manager,
        { workspaceId: input.workspaceId, botId: input.botId, day: utcDay(now) },
        {
          ...(input.origin === 'widget' && input.status === 'complete' ? { aiMessages: 1 } : {}),
          ...(input.decision === 'escalated' ? { escalations: 1 } : {}),
          ...(input.chat === null
            ? {}
            : { inputTokens: input.chat.inputTokens, outputTokens: input.chat.outputTokens }),
          ...(input.embedding === null ? {} : { embeddingTokens: input.embedding.tokens }),
          costUsd: totalCost.costUsd,
        },
      );

      if (input.conversationId !== null) {
        if (input.aiMessageId !== null) {
          await notifyWorkspace(manager, input.workspaceId, {
            type: 'message.created',
            conversationId: input.conversationId,
            messageId: input.aiMessageId,
            role: 'ai',
          });
        }
        if (conversationStatus !== null) {
          await notifyWorkspace(manager, input.workspaceId, {
            type: 'conversation.updated',
            conversationId: input.conversationId,
            botId: input.botId,
            status: conversationStatus,
          });
          if (this.outbox !== undefined) {
            await this.outbox.record(
              input.workspaceId,
              {
                type: 'conversation.updated',
                aggregateId: input.conversationId,
                idempotencyKey: `conversation:${input.conversationId}:updated:${traceId}`,
                data: {
                  conversationId: input.conversationId,
                  botId: input.botId,
                  status: conversationStatus,
                },
              },
              manager,
            );
          }
        }
        if (this.outbox !== undefined && input.aiMessageId !== null) {
          await this.outbox.record(
            input.workspaceId,
            {
              type: 'message.created',
              aggregateId: input.aiMessageId,
              idempotencyKey: `message:${input.aiMessageId}`,
              data: {
                conversationId: input.conversationId,
                messageId: input.aiMessageId,
                role: 'ai',
                status: input.status,
              },
            },
            manager,
          );
        }
        if (this.outbox !== undefined && handoff) {
          await this.outbox.record(
            input.workspaceId,
            {
              type: 'handoff.requested',
              aggregateId: input.conversationId,
              idempotencyKey: `handoff:${input.conversationId}:${traceId}`,
              data: {
                conversationId: input.conversationId,
                reason: input.escalation?.reason ?? 'unknown',
              },
            },
            manager,
          );
        }
      }
    });

    // After commit, never inside it: a listener must not act on a rolled-back handoff.
    if (handoff && input.conversationId !== null) {
      const event: ChatHandoffRequestedEvent = {
        workspaceId: input.workspaceId,
        botId: input.botId,
        conversationId: input.conversationId,
      };
      this.events.emit(CHAT_HANDOFF_REQUESTED, event);
    }

    // Not part of the transaction, and never a reason to report the answer as failed.
    try {
      await this.enqueueSpendAlerts(input.workspaceId, input.botId, totalCost.costUsd, now);
    } catch {
      // Best effort: the alert is a convenience, the answer is already committed.
    }

    return { traceId, costUsd: totalCost.costUsd };
  }

  /**
   * Spec §15.2: enqueue a threshold alert only on the crossing itself, so the ten answers that
   * follow an 80% crossing do not enqueue ten more alerts.
   */
  private async enqueueSpendAlerts(
    workspaceId: WorkspaceId,
    botId: string,
    costUsd: string,
    now: Date,
  ): Promise<void> {
    const bot = await this.bots.findById(workspaceId, botId);
    if (bot === null) return;
    if (bot.deletedAt !== null || bot.monthlySpendCapUsd === null) return;

    const mtd = new Big(await this.usage.monthToDateCost(workspaceId, botId, now));
    const before = mtd.minus(new Big(costUsd));
    const cap = new Big(bot.monthlySpendCapUsd);
    const month = utcMonthKey(now);

    for (const threshold of [80, 100] as const) {
      const limit = cap.times(threshold).div(100);
      if (before.lt(limit) && mtd.gte(limit)) {
        await this.jobs.enqueue(
          SPEND_ALERTS_JOB,
          { workspaceId, botId, threshold, month },
          { singletonKey: `${botId}:${month}:${String(threshold)}` },
        );
      }
    }
  }
}
