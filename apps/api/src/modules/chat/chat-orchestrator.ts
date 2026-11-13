// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { encode } from 'gpt-tokenizer';

import type { Citation, ErrorCode, HandoffReason, ProviderKind, TraceOrigin } from '@app/shared';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { newId } from '../../common/ids';
import type { WorkspaceId } from '../../db/ids';
import { Llm, ProviderError, type ModelMessage } from '../../providers';
import { BotsRepository, type BotEntity } from '../bots';
import { MessagesRepository } from '../conversations';
import { PromptsService } from '../prompts';
import { RetrievalService, selectUsedChunks, type RetrievalResult } from '../retrieval';
import { SpendCapService } from '../usage';
import type { AnswerSink } from './answer-sink';
import {
  ChatPersistence,
  type FinalizeInput,
  type BeginTurnResult,
} from './chat-persistence.service';
import { parseCitations } from './domain/citations';
import { decideRetrieval, escalationOutcome, type EscalationReason } from './domain/escalation';
import { detectHandoffIntent } from './domain/handoff-intent';
import { applyLinkPolicy, buildAllowedLinkHosts } from './domain/link-policy';
import { PLATFORM_PROMPT_VERSION } from './domain/platform-prompt';
import { assemblePrompt, type PromptHistoryMessage } from './domain/prompt-assembly';
import { buildRetrievalQuery } from './domain/retrieval-query';

/** Spec §13.5: longer messages are rejected before anything is stored. */
export const VISITOR_MESSAGE_MAX = 2_000;

export interface OrchestratorInput {
  workspaceId: WorkspaceId;
  botId: string;
  mode:
    | { kind: 'widget'; conversationId: string; content: string }
    | {
        kind: 'playground';
        history: { role: 'visitor' | 'ai'; content: string }[];
        content: string;
      };
  signal: AbortSignal;
}

/**
 * The chat pipeline of spec §13/§14: guard → persist → gate → intent → query → retrieve →
 * decide → assemble → generate → finalize. Every decision is a pure function in `domain/`;
 * this class only wires them and reports through the sink.
 */
@Injectable()
export class ChatOrchestrator {
  constructor(
    private readonly bots: BotsRepository,
    private readonly messages: MessagesRepository,
    private readonly persistence: ChatPersistence,
    private readonly prompts: PromptsService,
    private readonly retrieval: RetrievalService,
    private readonly spendCap: SpendCapService,
    private readonly llm: Llm,
    private readonly clock: Clock,
  ) {}

  async handle(input: OrchestratorInput, sink: AnswerSink): Promise<void> {
    const startedAt = this.clock.now().getTime();
    const origin: TraceOrigin = input.mode.kind;
    let turn: BeginTurnResult | null = null;
    let messageId = newId();

    try {
      if (input.mode.content.length > VISITOR_MESSAGE_MAX) {
        sink.error({
          code: 'message_too_long',
          message: `A message may be at most ${String(VISITOR_MESSAGE_MAX)} characters.`,
        });
        return;
      }

      if (input.mode.kind === 'widget') {
        turn = await this.persistence.beginTurn(
          input.workspaceId,
          input.mode.conversationId,
          input.mode.content,
        );
        messageId = turn.aiMessageId ?? messageId;
        sink.accepted({
          messageId: turn.visitorMessage.id,
          createdAt: turn.visitorMessage.createdAt.toISOString(),
        });
        // A human owns the conversation: the message is stored, the bot stays silent.
        if (turn.conversation.status !== 'ai') return;
      }

      const bot = await this.loadBot(input.workspaceId, input.botId);
      const history = await this.loadHistory(input, turn);
      const prompt = await this.prompts.getActive(input.workspaceId, input.botId);
      const operatorInstructions = prompt?.systemPrompt ?? '';
      const promptVersionId = prompt?.id ?? null;

      const spend = await this.spendCap.check(input.workspaceId, bot, this.clock.now());
      if (spend.state === 'reached') {
        await this.escalate({
          input,
          sink,
          bot,
          turn,
          messageId,
          startedAt,
          retrieved: null,
          usedIds: new Set(),
          promptVersionId,
          chatProvider: null,
          chat: null,
          error: null,
          requestSnapshot: null,
          ttftMs: null,
          reason: 'spend_cap_reached',
        });
        return;
      }

      if (bot.handoffEnabled && detectHandoffIntent(input.mode.content, bot.handoffPhrases)) {
        await this.escalate({
          input,
          sink,
          bot,
          turn,
          messageId,
          startedAt,
          retrieved: null,
          usedIds: new Set(),
          promptVersionId,
          chatProvider: null,
          chat: null,
          error: null,
          requestSnapshot: null,
          ttftMs: null,
          reason: 'handoff_intent',
        });
        return;
      }

      const visitorMessages = [
        ...history.filter((entry) => entry.role === 'visitor').map((entry) => entry.content),
        input.mode.content,
      ];
      const query = buildRetrievalQuery(visitorMessages);

      let retrieved: RetrievalResult;
      try {
        retrieved = await this.retrieval.retrieve(input.workspaceId, bot, query, input.signal);
      } catch (error) {
        if (isAbort(input.signal, error)) {
          await this.abortTurn(input, turn, '', startedAt);
          return;
        }
        const code = providerErrorCode(error);
        await this.escalate({
          input,
          sink,
          bot,
          turn,
          messageId,
          startedAt,
          retrieved: null,
          usedIds: new Set(),
          promptVersionId,
          chatProvider: await this.chatProvider(bot),
          chat: {
            provider: await this.chatProvider(bot),
            model: bot.chatModel,
            inputTokens: 0,
            outputTokens: 0,
          },
          error: code,
          requestSnapshot: null,
          ttftMs: null,
          reason: 'provider_error',
        });
        return;
      }

      const readyChunkCount = await this.retrieval.countReadyChunks(input.workspaceId, bot);
      const decision = decideRetrieval({
        readyChunkCount,
        topScore: retrieved.topScore,
        threshold: bot.retrievalThreshold,
      });
      if (decision.kind === 'escalate') {
        await this.escalate({
          input,
          sink,
          bot,
          turn,
          messageId,
          startedAt,
          retrieved,
          usedIds: new Set(),
          promptVersionId,
          chatProvider: null,
          chat: null,
          error: null,
          requestSnapshot: null,
          ttftMs: null,
          reason: decision.reason,
        });
        return;
      }

      const used = selectUsedChunks(retrieved.chunks, bot.retrievalThreshold);
      const usedIds = new Set(used.map((chunk) => chunk.chunkId));
      const sources = used.map((chunk, index) => ({
        n: index + 1,
        title: chunk.title,
        url: chunk.url,
        content: chunk.content,
      }));
      const messages = this.buildPrompt(
        bot,
        operatorInstructions,
        sources,
        history,
        input.mode.content,
      );
      const chatProvider = await this.chatProvider(bot);

      sink.started({ messageId });

      let partial = '';
      let ttftMs: number | null = null;
      try {
        const stream = this.llm.streamChat({
          workspaceId: input.workspaceId,
          credentialId: bot.chatCredentialId as never,
          model: bot.chatModel,
          messages,
          maxOutputTokens: bot.maxOutputTokens,
          temperature: bot.temperature,
          signal: input.signal,
        });
        for await (const delta of stream.textStream) {
          ttftMs ??= this.clock.now().getTime() - startedAt;
          partial += delta;
          sink.delta(delta);
        }
        const final = await stream.final;

        const citations = used.map((chunk, index) => ({ n: index + 1, chunk }));
        const parsed = parseCitations(
          partial,
          citations.map(({ n, chunk }): Citation => ({
            n,
            chunkId: chunk.chunkId,
            documentId: chunk.documentId,
            title: chunk.title,
            url: chunk.url,
          })),
        );
        const storedContent = applyLinkPolicy(
          parsed.text,
          buildAllowedLinkHosts({
            usedSourceUrls: used.map((chunk) => chunk.url),
            allowedOrigins: bot.allowedOrigins,
            allowedLinkDomains: bot.allowedLinkDomains,
          }),
        );

        // Spec §14.1/review focus 5: the bot may have been deleted while it was answering.
        if (!(await this.bots.existsLive(input.workspaceId, input.botId))) {
          await this.botUnavailable(input, sink, turn, partial);
          return;
        }

        const result = await this.persistence.finalize({
          workspaceId: input.workspaceId,
          botId: input.botId,
          conversationId: turn?.conversation.id ?? null,
          aiMessageId: turn?.aiMessageId ?? null,
          triggerMessageId: turn?.visitorMessage.id ?? null,
          origin,
          content: storedContent,
          status: 'complete',
          citations: parsed.citations,
          decision: 'answered',
          decisionReason: null,
          retrieval: retrievalTrace(retrieved, usedIds),
          topScore: retrieved.topScore,
          promptVersionId,
          platformPromptVersion: PLATFORM_PROMPT_VERSION,
          chat: {
            provider: chatProvider,
            model: bot.chatModel,
            inputTokens: final.inputTokens,
            outputTokens: final.outputTokens,
          },
          embedding: embeddingTrace(retrieved, bot),
          requestSnapshot: final.requestSnapshot,
          latencyMs: this.elapsed(startedAt),
          ttftMs: final.ttftMs,
          error: null,
          escalation: null,
        });

        sink.completed({ messageId, content: storedContent, citations: parsed.citations });
        if (origin === 'playground') {
          sink.trace?.({
            traceId: result.traceId,
            decision: 'answered',
            topScore: retrieved.topScore,
            inputTokens: final.inputTokens,
            outputTokens: final.outputTokens,
            costUsd: result.costUsd,
            latencyMs: this.elapsed(startedAt),
          });
        }
      } catch (error) {
        if (isAbort(input.signal, error)) {
          await this.abortTurn(input, turn, partial, startedAt);
          return;
        }
        await this.escalate({
          input,
          sink,
          bot,
          turn,
          messageId,
          startedAt,
          retrieved,
          usedIds,
          promptVersionId,
          chatProvider,
          chat: {
            provider: chatProvider,
            model: bot.chatModel,
            inputTokens: 0,
            outputTokens: encode(partial).length,
          },
          error: providerErrorCode(error),
          requestSnapshot: null,
          ttftMs,
          reason: 'provider_error',
        });
      }
    } catch (error) {
      const orphan = turn?.aiMessageId;
      if (orphan !== undefined && orphan !== null) {
        await this.persistence.markMessageError(input.workspaceId, orphan, '');
      }
      this.reportError(sink, error);
    }
  }

  private async loadBot(workspaceId: WorkspaceId, botId: string): Promise<BotEntity> {
    const bot = await this.bots.findById(workspaceId, botId);
    if (bot === null) throw new AppError('not_found');
    if (bot.deletedAt !== null) throw new AppError('not_found');
    return bot;
  }

  private async chatProvider(bot: BotEntity): Promise<ProviderKind> {
    return ((await this.bots.credentialProvider(bot.chatCredentialId)) ??
      'unknown') as ProviderKind;
  }

  private async loadHistory(
    input: OrchestratorInput,
    turn: BeginTurnResult | null,
  ): Promise<PromptHistoryMessage[]> {
    if (input.mode.kind === 'playground') {
      return input.mode.history.map((entry) => ({
        role: entry.role,
        content: entry.content,
      }));
    }
    if (turn === null) return [];
    const rows = await this.messages.listForConversation(input.workspaceId, turn.conversation.id);
    return rows
      .filter(
        (row) =>
          row.status === 'complete' &&
          row.id !== turn.visitorMessage.id &&
          row.id !== turn.aiMessageId &&
          (row.role === 'visitor' || row.role === 'ai' || row.role === 'agent'),
      )
      .map((row) => ({
        role: row.role as PromptHistoryMessage['role'],
        content: row.content,
      }));
  }

  private buildPrompt(
    bot: BotEntity,
    operatorInstructions: string,
    sources: { n: number; title: string; url: string | null; content: string }[],
    history: PromptHistoryMessage[],
    current: string,
  ): ModelMessage[] {
    return assemblePrompt({ botName: bot.name, operatorInstructions, sources, history, current });
  }

  /** Spec §14.2: one trace, one message, one usage update for every escalation. */
  private async escalate(args: {
    input: OrchestratorInput;
    sink: AnswerSink;
    bot: BotEntity;
    turn: BeginTurnResult | null;
    messageId: string;
    startedAt: number;
    retrieved: RetrievalResult | null;
    usedIds: Set<string>;
    promptVersionId: string | null;
    chatProvider: ProviderKind | null;
    chat: FinalizeInput['chat'];
    error: string | null;
    requestSnapshot: unknown;
    ttftMs: number | null;
    reason: EscalationReason;
  }): Promise<void> {
    const outcome = escalationOutcome(args.bot, args.reason);
    let result: { traceId: string; costUsd: string };
    try {
      result = await this.persistence.finalize({
        workspaceId: args.input.workspaceId,
        botId: args.input.botId,
        conversationId: args.turn?.conversation.id ?? null,
        aiMessageId: args.turn?.aiMessageId ?? null,
        triggerMessageId: args.turn?.visitorMessage.id ?? null,
        origin: args.input.mode.kind,
        content: outcome.content,
        status: 'complete',
        citations: [],
        decision: 'escalated',
        decisionReason: args.reason,
        retrieval: args.retrieved === null ? [] : retrievalTrace(args.retrieved, args.usedIds),
        topScore: args.retrieved?.topScore ?? null,
        promptVersionId: args.promptVersionId,
        platformPromptVersion: PLATFORM_PROMPT_VERSION,
        chat: args.chat,
        embedding: args.retrieved === null ? null : embeddingTrace(args.retrieved, args.bot),
        requestSnapshot: args.requestSnapshot,
        latencyMs: this.elapsed(args.startedAt),
        ttftMs: args.ttftMs,
        error: args.error,
        escalation: {
          setsNeedsHuman: outcome.setsNeedsHuman,
          reason: handoffReason(args.reason),
        },
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'not_found') {
        await this.botUnavailable(args.input, args.sink, args.turn, outcome.content);
        return;
      }
      this.reportError(args.sink, error);
      return;
    }

    if (args.reason === 'handoff_intent') {
      args.sink.handoffOffered({ messageId: args.messageId, reason: 'handoff_intent' });
    } else {
      args.sink.escalated({
        messageId: args.messageId,
        reason: args.reason,
        behavior: outcome.behavior,
        content: outcome.content,
      });
    }
    if (args.input.mode.kind === 'playground') {
      args.sink.trace?.({
        traceId: result.traceId,
        decision: 'escalated',
        topScore: args.retrieved?.topScore ?? null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: result.costUsd,
        latencyMs: this.elapsed(args.startedAt),
      });
    }
  }

  /** Spec §13.5: a disconnect stores the partial answer with `status = error`. */
  private async abortTurn(
    input: OrchestratorInput,
    turn: BeginTurnResult | null,
    partial: string,
    startedAt: number,
  ): Promise<void> {
    try {
      await this.persistence.finalize({
        workspaceId: input.workspaceId,
        botId: input.botId,
        conversationId: turn?.conversation.id ?? null,
        aiMessageId: turn?.aiMessageId ?? null,
        triggerMessageId: turn?.visitorMessage.id ?? null,
        origin: input.mode.kind,
        content: partial,
        status: 'error',
        citations: [],
        decision: 'error',
        decisionReason: 'aborted',
        retrieval: [],
        topScore: null,
        promptVersionId: null,
        platformPromptVersion: PLATFORM_PROMPT_VERSION,
        chat: null,
        embedding: null,
        requestSnapshot: null,
        latencyMs: this.elapsed(startedAt),
        ttftMs: null,
        error: 'aborted',
        escalation: null,
      });
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'not_found')) throw error;
    }
  }

  private async botUnavailable(
    input: OrchestratorInput,
    sink: AnswerSink,
    turn: BeginTurnResult | null,
    content: string,
  ): Promise<void> {
    const orphan = turn?.aiMessageId;
    if (orphan !== undefined && orphan !== null) {
      await this.persistence.markMessageError(input.workspaceId, orphan, content);
    }
    sink.error({
      code: 'bot_unavailable',
      message: 'This support bot is no longer available.',
    });
  }

  private reportError(sink: AnswerSink, error: unknown): void {
    if (error instanceof AppError) {
      const code: ErrorCode = error.code === 'not_found' ? 'bot_unavailable' : error.code;
      sink.error({ code, message: error.message });
      return;
    }
    sink.error({ code: 'internal_error', message: 'An internal error occurred.' });
  }

  private elapsed(startedAt: number): number {
    return Math.max(0, this.clock.now().getTime() - startedAt);
  }
}

function retrievalTrace(
  retrieved: RetrievalResult,
  usedIds: Set<string>,
): { chunkId: string; score: number; rank: number; used: boolean }[] {
  return retrieved.chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    score: chunk.score,
    rank: chunk.rank,
    used: usedIds.has(chunk.chunkId),
  }));
}

function embeddingTrace(
  retrieved: RetrievalResult,
  bot: BotEntity,
): { provider: ProviderKind; model: string; tokens: number } {
  return {
    provider: retrieved.embeddingProvider as ProviderKind,
    model: bot.embeddingModel,
    tokens: retrieved.embeddingTokens,
  };
}

function providerErrorCode(error: unknown): string {
  return error instanceof ProviderError ? error.code : 'provider_error';
}

/** A disconnect can surface as the caller's signal or as an SDK abort error. */
function isAbort(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted || (error instanceof ProviderError && error.code === 'aborted');
}

function handoffReason(reason: EscalationReason): HandoffReason {
  switch (reason) {
    case 'handoff_intent':
      return 'handoff_intent';
    case 'visitor_request':
      return 'visitor_request';
    case 'no_knowledge':
    case 'top_score_below_threshold':
    case 'spend_cap_reached':
    case 'provider_error':
      return 'no_answer';
  }
}
