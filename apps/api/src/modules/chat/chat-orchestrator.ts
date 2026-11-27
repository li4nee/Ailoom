// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';

import type {
  Citation,
  EvalToolDefinition,
  EvalToolFixture,
  ErrorCode,
  HandoffReason,
  ProviderKind,
  TraceOrigin,
  TraceToolCall,
} from '@app/shared';

import { ActiveStreams } from '../../common/active-streams';
import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { newId } from '../../common/ids';
import type { WorkspaceId } from '../../db/ids';
import {
  Llm,
  ProviderError,
  type ModelMessage,
  type ProviderToolDefinition,
} from '../../providers';
import { BotEntity, BotsRepository } from '../bots';
import { MessagesRepository } from '../conversations';
import { PromptsService } from '../prompts';
import { RetrievalService, selectUsedChunks, type RetrievalResult } from '../retrieval';
import { ToolsService } from '../tools';
import { validateToolArguments } from '../tools';
import { SpendCapService } from '../usage';
import type { AnswerSink } from './answer-sink';
import {
  ChatPersistence,
  type FinalizeInput,
  type BeginTurnResult,
} from './chat-persistence.service';
import { parseCitations } from './domain/citations';
import { decideRetrieval, escalationOutcome, type EscalationReason } from './domain/escalation';
import { shouldFailOver } from './domain/fallback';
import { detectHandoffIntent } from './domain/handoff-intent';
import { applyLinkPolicy, buildAllowedLinkHosts } from './domain/link-policy';
import { PLATFORM_PROMPT_VERSION } from './domain/platform-prompt';
import { assemblePrompt, type PromptHistoryMessage } from './domain/prompt-assembly';
import { buildRetrievalQuery } from './domain/retrieval-query';
import { QueryRewriter, type QueryRewriteResult } from './query-rewriter.service';

/** Spec §13.5: longer messages are rejected before anything is stored. */
export const VISITOR_MESSAGE_MAX = 2_000;

function snapshotWithFallback(
  snapshot: unknown,
  fallbackFrom: { provider: ProviderKind; model: string; errorCode: string },
): unknown {
  return snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? { ...(snapshot as Record<string, unknown>), fallbackFrom }
    : { providerSnapshot: snapshot, fallbackFrom };
}

export interface OrchestratorInput {
  workspaceId: WorkspaceId;
  botId: string;
  mode:
    | { kind: 'widget'; conversationId: string; content: string }
    | {
        kind: 'playground';
        history: { role: 'visitor' | 'ai'; content: string }[];
        content: string;
      }
    | {
        kind: 'eval';
        runId: string;
        caseId: string;
        history: { role: 'visitor' | 'ai'; content: string }[];
        content: string;
        overrides: {
          promptVersionId?: string | null;
          chatCredentialId?: string;
          chatModel?: string;
          retrievalThreshold?: number;
          retrievalMode?: 'vector' | 'hybrid';
          rerankingEnabled?: boolean;
          queryRewritingEnabled?: boolean;
          toolDefinitions?: EvalToolDefinition[];
          toolFixtures?: EvalToolFixture[];
        };
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
    private readonly activeStreams: ActiveStreams,
    private readonly tools: ToolsService,
    private readonly queryRewriter: QueryRewriter,
  ) {}

  async handle(input: OrchestratorInput, sink: AnswerSink): Promise<void> {
    const startedAt = this.clock.now().getTime();
    const toolTurnId = newId();
    const origin: TraceOrigin = input.mode.kind;
    let turn: BeginTurnResult | null = null;
    let messageId = newId();
    let queryRewrite: QueryRewriteResult;

    // The caller's signal (visitor disconnected) and the agent-action registry both abort this
    // controller, so a takeover and a closed tab take the same path out of the stream.
    const controller = new AbortController();
    const signal = controller.signal;
    const forwardAbort = (): void => {
      controller.abort();
    };
    if (input.signal.aborted) controller.abort();
    else input.signal.addEventListener('abort', forwardAbort, { once: true });
    const unregister =
      input.mode.kind === 'widget'
        ? this.activeStreams.register(input.mode.conversationId, controller)
        : (): void => undefined;

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

      const originalBot = await this.loadBot(input.workspaceId, input.botId);
      const bot =
        input.mode.kind === 'eval'
          ? Object.assign(new BotEntity(), originalBot, {
              chatCredentialId:
                input.mode.overrides.chatCredentialId ?? originalBot.chatCredentialId,
              chatModel: input.mode.overrides.chatModel ?? originalBot.chatModel,
              retrievalThreshold:
                input.mode.overrides.retrievalThreshold ?? originalBot.retrievalThreshold,
              retrievalMode: input.mode.overrides.retrievalMode ?? originalBot.retrievalMode,
              rerankingEnabled:
                input.mode.overrides.rerankingEnabled ?? originalBot.rerankingEnabled,
              queryRewritingEnabled:
                input.mode.overrides.queryRewritingEnabled ?? originalBot.queryRewritingEnabled,
            })
          : originalBot;
      const evalPromptId =
        input.mode.kind === 'eval' ? input.mode.overrides.promptVersionId : undefined;
      const promptPromise =
        evalPromptId === undefined
          ? this.prompts.getActive(input.workspaceId, input.botId, bot)
          : evalPromptId === null
            ? Promise.resolve(null)
            : this.prompts.getForEval(input.workspaceId, input.botId, evalPromptId);
      const [history, prompt] = await Promise.all([this.loadHistory(input, turn), promptPromise]);
      const operatorInstructions = prompt?.systemPrompt ?? '';
      const promptVersionId = prompt?.id ?? null;
      // Evaluation fixtures remain self-contained and never call live customer APIs.
      const enabledTools =
        input.mode.kind === 'eval' ||
        !(await this.tools.botModelsSupportTools(input.workspaceId, bot.id))
          ? []
          : await this.tools.enabledForBot(input.workspaceId, bot.id);
      const configuredTools =
        input.mode.kind === 'eval'
          ? (input.mode.overrides.toolDefinitions ?? []).map((tool) => ({
              ...tool,
              version: tool.version,
              responseFields: tool.responseFields.map((field) => ({
                ...field,
                visibleToVisitor: true,
              })),
            }))
          : enabledTools;
      const toolFixtures =
        input.mode.kind === 'eval' ? (input.mode.overrides.toolFixtures ?? []) : [];

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
          chat: null,
          error: null,
          requestSnapshot: null,
          ttftMs: null,
          reason: 'handoff_intent',
        });
        return;
      }

      // Credential metadata is needed for pricing and traces, but not for retrieval. Start the
      // small lookup before embedding/search so it does not sit on the critical path to the LLM.
      const chatProvider = this.chatProvider(bot);

      const visitorMessages = [
        ...history.filter((entry) => entry.role === 'visitor').map((entry) => entry.content),
        input.mode.content,
      ];
      const fallbackQuery = buildRetrievalQuery(visitorMessages);
      if (bot.queryRewritingEnabled) {
        try {
          queryRewrite = await this.queryRewriter.rewrite({
            workspaceId: input.workspaceId,
            credentialId: bot.chatCredentialId,
            provider: await chatProvider,
            model: bot.chatModel,
            visitorMessages,
            fallbackQuery,
            signal,
          });
        } catch (error) {
          if (isAbort(signal, error)) {
            await this.abortTurn(input, turn, '', startedAt, null, bot);
            return;
          }
          queryRewrite = {
            query: fallbackQuery,
            applied: false,
            durationMs: 0,
            failure: 'unavailable',
            usage: null,
          };
        }
      } else {
        queryRewrite = {
          query: fallbackQuery,
          applied: false,
          durationMs: 0,
          failure: null,
          usage: null,
        };
      }
      const query = queryRewrite.query;

      let retrieved: RetrievalResult;
      try {
        retrieved = await this.retrieval.retrieve(input.workspaceId, bot, query, signal, {
          bill: false,
        });
      } catch (error) {
        if (isAbort(signal, error)) {
          await this.abortTurn(input, turn, '', startedAt, null, bot, null, null, queryRewrite);
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
          chat: {
            provider: await chatProvider,
            model: bot.chatModel,
            inputTokens: 0,
            outputTokens: 0,
          },
          error: code,
          requestSnapshot: null,
          ttftMs: null,
          reason: 'provider_error',
          queryRewrite,
        });
        return;
      }

      // A non-empty result already proves that the bot has reachable ready chunks. Only an
      // empty search needs the extra count query to distinguish `no_knowledge` from a query
      // whose best score is below the retrieval threshold.
      const readyChunkCount =
        retrieved.chunks.length > 0
          ? retrieved.chunks.length
          : await this.retrieval.countReadyChunks(input.workspaceId, bot);
      const decision = decideRetrieval({
        readyChunkCount,
        topScore: retrieved.topScore,
        threshold: bot.retrievalThreshold,
      });
      if (decision.kind === 'escalate' && configuredTools.length === 0) {
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
          chat: null,
          error: null,
          requestSnapshot: null,
          ttftMs: null,
          reason: decision.reason,
          queryRewrite,
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
        configuredTools.length > 0,
      );
      sink.started({ messageId });

      let partial = '';
      let ttftMs: number | null = null;
      let answeredProvider = await chatProvider;
      let answeredModel = bot.chatModel;
      let decisionReason: string | null = null;
      let fallbackFrom: { provider: ProviderKind; model: string; errorCode: string } | null = null;
      const fallbackFailure: { failed: boolean; snapshot: unknown } = {
        failed: false,
        snapshot: null,
      };
      const toolExecution = { started: false, progressSent: false };
      const toolCallsByName = new Map<string, number>();
      const toolTraceCalls: TraceToolCall[] = [];
      const consumedEvalFixtures = new Set<number>();
      const providerTools: Record<string, ProviderToolDefinition> = Object.fromEntries(
        configuredTools.map((configuredTool) => [
          configuredTool.name,
          {
            description: [
              configuredTool.description,
              `Use when: ${configuredTool.useWhen}`,
              `Never use when: ${configuredTool.neverUse}`,
              `If the call fails: ${configuredTool.failureBehavior}`,
              'If the result contains _toolFailure=true, the external lookup failed. Follow the failure instructions above, use only other reliable context, say you could not verify the result when needed, and do not invent a tool result or retry.',
              `You may receive these fields: ${configuredTool.responseFields
                .filter((field) => field.visibleToVisitor)
                .map((field) => `${field.name} (${field.description})`)
                .join(', ')}`,
              'Do not send other visitor information to this tool.',
            ].join('\n'),
            inputSchema: this.tools.toModelSchema(configuredTool),
            execute: async (toolInput: unknown) => {
              const calls = (toolCallsByName.get(configuredTool.name) ?? 0) + 1;
              if (calls > configuredTool.maxCalls) {
                throw new AppError('validation_failed');
              }
              toolCallsByName.set(configuredTool.name, calls);
              toolExecution.started = true;
              if (!toolExecution.progressSent) {
                sink.toolProgress?.();
                toolExecution.progressSent = true;
              }
              if (input.mode.kind === 'eval') {
                const startedAt = Date.now();
                const summary: TraceToolCall = {
                  name: configuredTool.name,
                  toolVersion: configuredTool.version,
                  inputFields: configuredTool.inputs
                    .filter(
                      (field) =>
                        toolInput !== null &&
                        typeof toolInput === 'object' &&
                        !Array.isArray(toolInput) &&
                        Object.prototype.hasOwnProperty.call(toolInput, field.name),
                    )
                    .map((field) => field.name),
                  outputFields: [],
                  status: 'failed',
                  durationMs: 0,
                };
                toolTraceCalls.push(summary);
                try {
                  const result = executeEvalFixture(
                    configuredTool,
                    toolInput,
                    toolFixtures,
                    consumedEvalFixtures,
                  );
                  summary.status = 'complete';
                  summary.outputFields = Object.keys(result);
                  return result;
                } finally {
                  summary.durationMs = Math.max(0, Date.now() - startedAt);
                }
              }
              try {
                return await this.tools.executeByName(
                  input.workspaceId,
                  bot.id,
                  turn?.conversation.id ?? null,
                  toolTurnId,
                  configuredTool.id,
                  configuredTool.name,
                  configuredTool.version,
                  toolInput,
                  signal,
                  toolTraceCalls,
                );
              } catch (error) {
                // Remote tool failures should be visible to the model as a bounded result,
                // rather than turning an otherwise answerable chat into a failed generation.
                // Keep cancellation and local policy/configuration errors fail-closed.
                if (
                  signal.aborted ||
                  !(error instanceof AppError) ||
                  error.code !== 'internal_error'
                ) {
                  throw error;
                }
                return { _toolFailure: true };
              }
            },
          },
        ]),
      );
      const toolRequest =
        Object.keys(providerTools).length === 0
          ? {}
          : { tools: providerTools, maxToolCalls: 3, maxSteps: 4 };
      let activeStream: ReturnType<Llm['streamChat']> | null = null;
      let currentChatUsage: NonNullable<FinalizeInput['chat']> = {
        provider: answeredProvider,
        model: answeredModel,
        inputTokens: 0,
        outputTokens: 0,
      };
      const failedChatCalls: NonNullable<FinalizeInput['additionalChatCalls']> = [];
      try {
        let final: Awaited<ReturnType<Llm['streamChat']>['final']>;
        try {
          activeStream = this.llm.streamChat({
            workspaceId: input.workspaceId,
            credentialId: bot.chatCredentialId as never,
            model: bot.chatModel,
            messages,
            maxOutputTokens: bot.maxOutputTokens,
            temperature: bot.temperature,
            signal,
            ...toolRequest,
          });
          for await (const delta of activeStream.textStream) {
            ttftMs ??= this.clock.now().getTime() - startedAt;
            partial += delta;
            sink.delta(delta);
          }
          final = await activeStream.final;
          currentChatUsage = {
            provider: answeredProvider,
            model: answeredModel,
            inputTokens: final.inputTokens,
            outputTokens: final.outputTokens,
          };
          activeStream = null;
        } catch (primaryError) {
          if (activeStream !== null) {
            const usage = activeStream.usageSnapshot?.() ?? { inputTokens: 0, outputTokens: 0 };
            currentChatUsage = {
              provider: answeredProvider,
              model: bot.chatModel,
              ...usage,
            };
            activeStream = null;
          }
          if (
            bot.fallbackChatCredentialId === null ||
            bot.fallbackChatModel === null ||
            toolExecution.started ||
            !shouldFailOver(primaryError, ttftMs !== null, signal)
          ) {
            throw primaryError;
          }

          if (currentChatUsage.inputTokens > 0 || currentChatUsage.outputTokens > 0) {
            failedChatCalls.push(currentChatUsage);
          }

          fallbackFrom = {
            provider: answeredProvider,
            model: bot.chatModel,
            errorCode: providerErrorCode(primaryError),
          };
          partial = '';
          answeredProvider = ((await this.bots.credentialProvider(bot.fallbackChatCredentialId)) ??
            'unknown') as ProviderKind;
          answeredModel = bot.fallbackChatModel;
          currentChatUsage = {
            provider: answeredProvider,
            model: answeredModel,
            inputTokens: 0,
            outputTokens: 0,
          };

          try {
            activeStream = this.llm.streamChat({
              workspaceId: input.workspaceId,
              credentialId: bot.fallbackChatCredentialId as never,
              model: bot.fallbackChatModel,
              messages,
              maxOutputTokens: bot.maxOutputTokens,
              temperature: bot.temperature,
              signal,
              ...toolRequest,
            });
            for await (const delta of activeStream.textStream) {
              ttftMs ??= this.clock.now().getTime() - startedAt;
              partial += delta;
              sink.delta(delta);
            }
            final = await activeStream.final;
            currentChatUsage = {
              provider: answeredProvider,
              model: answeredModel,
              inputTokens: final.inputTokens,
              outputTokens: final.outputTokens,
            };
            activeStream = null;
          } catch (fallbackError) {
            if (activeStream !== null) {
              const usage = activeStream.usageSnapshot?.() ?? { inputTokens: 0, outputTokens: 0 };
              currentChatUsage = {
                provider: answeredProvider,
                model: answeredModel,
                ...usage,
              };
              activeStream = null;
            }
            fallbackFailure.failed = true;
            fallbackFailure.snapshot = {
              fallbackFrom,
              fallbackErrorCode: providerErrorCode(fallbackError),
            };
            throw fallbackError;
          }
          decisionReason = 'answered_by_fallback';
          final = {
            ...final,
            requestSnapshot: snapshotWithFallback(final.requestSnapshot, fallbackFrom),
          };
        }

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
          decisionReason,
          retrieval: retrievalTrace(retrieved, usedIds),
          retrievalMode: retrieved.retrievalMode,
          retrievalMs: retrieved.retrievalMs,
          rerankingApplied: retrieved.rerankingApplied,
          rerankingMs: retrieved.rerankingMs,
          rerankingFailure: retrieved.rerankingFailure,
          queryRewritingApplied: queryRewrite.applied,
          queryRewritingMs: queryRewrite.durationMs,
          queryRewritingFailure: queryRewrite.failure,
          retrievalCostUsd: retrieved.retrievalCostUsd,
          topScore: retrieved.topScore,
          promptVersionId,
          platformPromptVersion: PLATFORM_PROMPT_VERSION,
          chat: currentChatUsage,
          additionalChatCalls: [
            ...failedChatCalls,
            ...(queryRewrite.usage === null ? [] : [queryRewrite.usage]),
          ],
          embedding: embeddingTrace(retrieved, bot),
          // The final provider request can contain earlier tool results. Do not store those
          // result values in the trace snapshot; the redacted invocation summary is separate.
          requestSnapshot: toolExecution.started ? null : final.requestSnapshot,
          toolCalls: toolTraceCalls,
          toolTurnId,
          latencyMs: this.elapsed(startedAt),
          ttftMs,
          error: null,
          escalation: null,
        });

        sink.completed({ messageId, content: storedContent, citations: parsed.citations });
        if (origin === 'playground' || origin === 'eval') {
          sink.trace?.({
            traceId: result.traceId,
            decision: 'answered',
            topScore: retrieved.topScore,
            inputTokens:
              currentChatUsage.inputTokens +
              failedChatCalls.reduce((sum, call) => sum + call.inputTokens, 0) +
              (queryRewrite.usage?.inputTokens ?? 0),
            outputTokens:
              currentChatUsage.outputTokens +
              failedChatCalls.reduce((sum, call) => sum + call.outputTokens, 0) +
              (queryRewrite.usage?.outputTokens ?? 0),
            costUsd: result.costUsd,
            latencyMs: this.elapsed(startedAt),
          });
        }
      } catch (error) {
        if (isAbort(signal, error)) {
          await this.abortTurn(
            input,
            turn,
            partial,
            startedAt,
            retrieved,
            bot,
            {
              toolTurnId,
              toolCalls: toolTraceCalls,
            },
            currentChatUsage,
            queryRewrite,
            failedChatCalls,
          );
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
          chat: currentChatUsage,
          error: providerErrorCode(error),
          requestSnapshot: fallbackFailure.failed ? fallbackFailure.snapshot : null,
          ttftMs,
          reason: 'provider_error',
          queryRewrite,
          additionalChatCalls: failedChatCalls,
          toolTurnId,
          toolCalls: toolTraceCalls,
          ...(fallbackFailure.failed ? { decisionReason: 'fallback_failed' } : {}),
        });
      }
    } catch (error) {
      const orphan = turn?.aiMessageId;
      if (orphan !== undefined && orphan !== null) {
        await this.persistence.markMessageError(input.workspaceId, orphan, '');
      }
      this.reportError(sink, error);
    } finally {
      unregister();
      input.signal.removeEventListener('abort', forwardAbort);
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
    if (input.mode.kind === 'playground' || input.mode.kind === 'eval') {
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
    toolsEnabled: boolean,
  ): ModelMessage[] {
    return assemblePrompt({
      botName: bot.name,
      operatorInstructions,
      sources,
      history,
      current,
      toolsEnabled,
    });
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
    chat: FinalizeInput['chat'];
    additionalChatCalls?: NonNullable<FinalizeInput['additionalChatCalls']>;
    error: string | null;
    requestSnapshot: unknown;
    ttftMs: number | null;
    reason: EscalationReason;
    queryRewrite?: QueryRewriteResult | null;
    decisionReason?: string;
    toolCalls?: TraceToolCall[];
    toolTurnId?: string;
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
        decisionReason: args.decisionReason ?? args.reason,
        retrieval: args.retrieved === null ? [] : retrievalTrace(args.retrieved, args.usedIds),
        retrievalMode: args.retrieved?.retrievalMode ?? args.bot.retrievalMode,
        retrievalMs: args.retrieved?.retrievalMs,
        rerankingApplied: args.retrieved?.rerankingApplied,
        rerankingMs: args.retrieved?.rerankingMs,
        rerankingFailure: args.retrieved?.rerankingFailure,
        queryRewritingApplied: args.queryRewrite?.applied ?? false,
        queryRewritingMs: args.queryRewrite?.durationMs ?? 0,
        queryRewritingFailure: args.queryRewrite?.failure ?? null,
        retrievalCostUsd: args.retrieved?.retrievalCostUsd,
        topScore: args.retrieved?.topScore ?? null,
        promptVersionId: args.promptVersionId,
        platformPromptVersion: PLATFORM_PROMPT_VERSION,
        chat: args.chat,
        additionalChatCalls: [
          ...(args.additionalChatCalls ?? []),
          ...(args.queryRewrite?.usage === null || args.queryRewrite?.usage === undefined
            ? []
            : [args.queryRewrite.usage]),
        ],
        embedding: args.retrieved === null ? null : embeddingTrace(args.retrieved, args.bot),
        requestSnapshot: args.requestSnapshot,
        latencyMs: this.elapsed(args.startedAt),
        ttftMs: args.ttftMs,
        error: args.error,
        toolCalls: args.toolCalls ?? [],
        ...(args.toolTurnId === undefined ? {} : { toolTurnId: args.toolTurnId }),
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
    if (args.input.mode.kind === 'playground' || args.input.mode.kind === 'eval') {
      args.sink.trace?.({
        traceId: result.traceId,
        decision: 'escalated',
        topScore: args.retrieved?.topScore ?? null,
        inputTokens:
          (args.chat?.inputTokens ?? 0) +
          (args.additionalChatCalls ?? []).reduce((sum, call) => sum + call.inputTokens, 0) +
          (args.queryRewrite?.usage?.inputTokens ?? 0),
        outputTokens:
          (args.chat?.outputTokens ?? 0) +
          (args.additionalChatCalls ?? []).reduce((sum, call) => sum + call.outputTokens, 0) +
          (args.queryRewrite?.usage?.outputTokens ?? 0),
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
    retrieved: RetrievalResult | null,
    bot: BotEntity,
    toolExecution: { toolTurnId: string; toolCalls: TraceToolCall[] } | null = null,
    chat: FinalizeInput['chat'] = null,
    queryRewrite: QueryRewriteResult | null = null,
    additionalChatCalls: NonNullable<FinalizeInput['additionalChatCalls']> = [],
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
        retrieval: retrieved === null ? [] : retrievalTrace(retrieved, new Set()),
        retrievalMode: retrieved?.retrievalMode ?? bot.retrievalMode,
        retrievalMs: retrieved?.retrievalMs,
        rerankingApplied: retrieved?.rerankingApplied,
        rerankingMs: retrieved?.rerankingMs,
        rerankingFailure: retrieved?.rerankingFailure,
        queryRewritingApplied: queryRewrite?.applied ?? false,
        queryRewritingMs: queryRewrite?.durationMs ?? 0,
        queryRewritingFailure: queryRewrite?.failure ?? null,
        retrievalCostUsd: retrieved?.retrievalCostUsd,
        topScore: retrieved?.topScore ?? null,
        promptVersionId: null,
        platformPromptVersion: PLATFORM_PROMPT_VERSION,
        chat,
        additionalChatCalls: [
          ...additionalChatCalls,
          ...(queryRewrite?.usage === null || queryRewrite?.usage === undefined
            ? []
            : [queryRewrite.usage]),
        ],
        // The query embedding was already paid for before the stream began.
        embedding: retrieved === null ? null : embeddingTrace(retrieved, bot),
        requestSnapshot: null,
        toolCalls: toolExecution?.toolCalls ?? [],
        ...(toolExecution === null ? {} : { toolTurnId: toolExecution.toolTurnId }),
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function executeEvalFixture(
  tool: Pick<EvalToolDefinition, 'name' | 'inputs' | 'responseFields'>,
  rawArguments: unknown,
  fixtures: EvalToolFixture[],
  consumed: Set<number>,
): Record<string, unknown> {
  const validatedArguments = validateToolArguments(tool, rawArguments);
  const fixtureIndex = fixtures.findIndex((fixture, index) => {
    if (consumed.has(index) || fixture.toolName !== tool.name) return false;
    const fixtureArguments = validateToolArguments(tool, fixture.arguments);
    return stableJson(fixtureArguments) === stableJson(validatedArguments);
  });
  if (fixtureIndex < 0) throw new AppError('validation_failed');
  const fixture = fixtures[fixtureIndex];
  if (fixture === undefined) throw new AppError('validation_failed');
  consumed.add(fixtureIndex);
  const visibleFields = new Set(tool.responseFields.map((field) => field.name));
  for (const [name, value] of Object.entries(fixture.result)) {
    const scalar =
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value));
    if (
      !visibleFields.has(name) ||
      !scalar ||
      (typeof value === 'string' && value.length > 1_000)
    ) {
      throw new AppError('validation_failed');
    }
  }
  return fixture.result;
}

function retrievalTrace(
  retrieved: RetrievalResult,
  usedIds: Set<string>,
): {
  chunkId: string;
  score: number;
  rank: number;
  used: boolean;
  vectorRank?: number | null;
  keywordRank?: number | null;
  fusionScore?: number;
  originalRank?: number;
  rerankScore?: number;
}[] {
  return retrieved.chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    score: chunk.score,
    rank: chunk.rank,
    used: usedIds.has(chunk.chunkId),
    ...(chunk.vectorRank === undefined ? {} : { vectorRank: chunk.vectorRank }),
    ...(chunk.keywordRank === undefined ? {} : { keywordRank: chunk.keywordRank }),
    ...(chunk.fusionScore === undefined ? {} : { fusionScore: chunk.fusionScore }),
    ...(chunk.originalRank === undefined ? {} : { originalRank: chunk.originalRank }),
    ...(chunk.rerankScore === undefined ? {} : { rerankScore: chunk.rerankScore }),
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
