// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, Optional } from '@nestjs/common';
import { embedMany, jsonSchema, stepCountIs, streamText, tool } from 'ai';

import { Clock } from '../common/clock';
import { ProviderError, toProviderError } from './errors';
import { ProviderRegistry } from './registry';
import { capSnapshot } from './snapshot';
import {
  type ChatModel,
  CREDENTIAL_RESOLVER,
  type EmbeddingModel,
  LLM_CALL_TIMEOUT_MS,
  type CredentialResolver,
  type EmbedRequest,
  type EmbedResult,
  type ResolvedCredential,
  type StreamChatFinal,
  type StreamChatRequest,
  type StreamChatResult,
} from './types';

/** Hard ceiling per model call (spec §11.3). */
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;
/** Spec 14.1: a chat answer fails after one retry. */
const CHAT_MAX_RETRIES = 1;
/** pg-boss owns embedding job retries (spec 12.5). */
const EMBED_MAX_RETRIES = 0;
/** Spec principle: no telemetry, even if an integration is registered globally. */
const TELEMETRY_OFF = { isEnabled: false } as const;

/** Attributes a failure to the caller's abort, the hard timeout, or the provider, in that order. */
function failure(callerSignal: AbortSignal, timeout: AbortSignal, error: unknown): ProviderError {
  if (callerSignal.aborted) return new ProviderError('aborted');
  if (timeout.aborted) return new ProviderError('timeout');
  return toProviderError(error);
}

/**
 * The only way the platform calls a model (spec §11.3). Credentials are resolved within the
 * request's workspace; every failure surfaces as a `ProviderError`, except a credential that
 * cannot be resolved, whose error (e.g. `not_found`) passes through untouched.
 */
@Injectable()
export class Llm {
  constructor(
    private readonly registry: ProviderRegistry,
    @Inject(CREDENTIAL_RESOLVER) private readonly resolver: CredentialResolver,
    private readonly clock: Clock,
    @Optional()
    @Inject(LLM_CALL_TIMEOUT_MS)
    private readonly timeoutMs: number = DEFAULT_CALL_TIMEOUT_MS,
  ) {}

  /** Builds the model; factory failures (bad base URL, …) never escape unmapped. */
  private chatModel(credential: ResolvedCredential, modelId: string): ChatModel {
    try {
      return this.registry.languageModel(credential, modelId);
    } catch (error) {
      throw toProviderError(error);
    }
  }

  private embeddingModel(credential: ResolvedCredential, modelId: string): EmbeddingModel {
    try {
      return this.registry.embeddingModel(credential, modelId);
    } catch (error) {
      throw toProviderError(error);
    }
  }

  /** Streams a chat answer. Read `textStream` to the end, then await `final`. */
  streamChat(req: StreamChatRequest): StreamChatResult {
    const clock = this.clock;
    const startedAt = clock.now().getTime();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([req.signal, timeout]);
    // streamText reports stream errors through onError and ends its streams quietly, so the
    // outcome is recorded here and turned into a ProviderError for both consumers.
    const outcome: { failed: boolean; error: unknown; interrupted: boolean } = {
      failed: false,
      error: undefined,
      interrupted: false,
    };
    let firstDeltaAt: number | undefined;
    const executedToolCalls: { name: string; input: unknown; output: unknown }[] = [];
    const completedUsage = { inputTokens: 0, outputTokens: 0 };
    let toolCallCount = 0;
    let toolExecutionQueue: Promise<void> = Promise.resolve();

    const fail = (error: unknown): ProviderError =>
      failure(req.signal, timeout, outcome.failed ? outcome.error : error);
    const unfinished = (): boolean => outcome.failed || outcome.interrupted;

    const started = (async () => {
      const credential = await this.resolver.resolveForUse(req.workspaceId, req.credentialId);
      const model = this.chatModel(credential, req.model);
      // AI SDK v7 takes system text as `instructions`, not as a system message in `messages`.
      const instructions = req.messages
        .filter((message) => message.role === 'system')
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('\n\n');
      const messages = req.messages.filter((message) => message.role !== 'system');
      const tools = Object.fromEntries(
        Object.entries(req.tools ?? {}).map(([name, definition]) => [
          name,
          tool({
            description: definition.description,
            inputSchema: jsonSchema(definition.inputSchema),
            execute: async (input: unknown) => {
              toolCallCount += 1;
              if (toolCallCount > (req.maxToolCalls ?? 0)) {
                throw new Error('The tool call limit was reached.');
              }
              const execution = toolExecutionQueue.then(async () => {
                const output = await definition.execute(input);
                executedToolCalls.push({ name, input, output });
                return output;
              });
              toolExecutionQueue = execution.then(
                () => undefined,
                () => undefined,
              );
              return execution;
            },
          }),
        ]),
      );
      return streamText({
        model,
        ...(instructions === '' ? {} : { instructions }),
        messages,
        ...(Object.keys(tools).length === 0
          ? {}
          : { tools, stopWhen: stepCountIs(req.maxSteps ?? 1) }),
        maxOutputTokens: req.maxOutputTokens,
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        abortSignal: signal,
        maxRetries: CHAT_MAX_RETRIES,
        include: { requestBody: true },
        telemetry: TELEMETRY_OFF,
        onError: ({ error }) => {
          if (!outcome.failed) {
            outcome.failed = true;
            outcome.error = error;
          }
        },
        // Time to first token is when the first text arrives, however late the caller reads.
        onChunk: ({ chunk }) => {
          if (firstDeltaAt === undefined && chunk.type === 'text-delta' && chunk.text !== '') {
            firstDeltaAt = clock.now().getTime();
          }
        },
        onAbort: () => {
          outcome.interrupted = true;
        },
        onStepEnd: ({ usage }) => {
          completedUsage.inputTokens += usage.inputTokens ?? 0;
          completedUsage.outputTokens += usage.outputTokens ?? 0;
        },
      });
    })();

    async function* textStream(): AsyncGenerator<string> {
      const result = await started;
      try {
        for await (const delta of result.textStream) yield delta;
      } catch (error) {
        throw fail(error);
      }
      if (unfinished()) throw fail(undefined);
    }

    const final = (async (): Promise<StreamChatFinal> => {
      const result = await started;
      let usage: Awaited<typeof result.usage>;
      let step: Awaited<typeof result.finalStep>;
      try {
        [usage, step] = await Promise.all([result.usage, result.finalStep]);
      } catch (error) {
        throw fail(error);
      }
      if (unfinished()) throw fail(undefined);
      return {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        ttftMs: (firstDeltaAt ?? clock.now().getTime()) - startedAt,
        requestSnapshot: capSnapshot(step.request.body),
        toolCalls: executedToolCalls,
      };
    })();
    // A caller that stops after textStream throws never awaits `final`; that is not a crash.
    final.catch(() => undefined);

    return {
      textStream: textStream(),
      final,
      usageSnapshot: () => ({ ...completedUsage }),
    };
  }

  /** Embeds a batch in one attempt; the job queue owns retries. */
  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const credential = await this.resolver.resolveForUse(req.workspaceId, req.credentialId);
    const model = this.embeddingModel(credential, req.model);
    try {
      const { embeddings, usage } = await embedMany({
        model,
        values: req.inputs,
        // Read by the local provider (see local/local-embedding-model.ts). Every provider
        // only reads its own namespace, so the others never see it.
        providerOptions: { local: { purpose: req.purpose ?? 'document' } },
        maxRetries: EMBED_MAX_RETRIES,
        abortSignal: AbortSignal.any([req.signal, timeout]),
        telemetry: TELEMETRY_OFF,
      });
      return { vectors: embeddings, tokens: usage.tokens };
    } catch (error) {
      throw failure(req.signal, timeout, error);
    }
  }
}
