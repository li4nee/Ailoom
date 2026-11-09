// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { embedMany, streamText } from 'ai';

import { Clock } from '../common/clock';
import { ProviderError, toProviderError } from './errors';
import { ProviderRegistry } from './registry';
import { capSnapshot } from './snapshot';
import {
  CREDENTIAL_RESOLVER,
  type CredentialResolver,
  type EmbedRequest,
  type EmbedResult,
  type StreamChatFinal,
  type StreamChatRequest,
  type StreamChatResult,
} from './types';

/** Hard ceiling per model call (spec §11.3). */
const CALL_TIMEOUT_MS = 60_000;
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
  ) {}

  /** Streams a chat answer. Read `textStream` to the end, then await `final`. */
  streamChat(req: StreamChatRequest): StreamChatResult {
    const clock = this.clock;
    const startedAt = clock.now().getTime();
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
    const signal = AbortSignal.any([req.signal, timeout]);
    // streamText reports stream errors through onError and ends its streams quietly, so the
    // outcome is recorded here and turned into a ProviderError for both consumers.
    const outcome: { failed: boolean; error: unknown; interrupted: boolean } = {
      failed: false,
      error: undefined,
      interrupted: false,
    };
    let firstDeltaAt: number | undefined;

    const fail = (error: unknown): ProviderError =>
      failure(req.signal, timeout, outcome.failed ? outcome.error : error);
    const unfinished = (): boolean => outcome.failed || outcome.interrupted;

    const started = (async () => {
      const credential = await this.resolver.resolveForUse(req.workspaceId, req.credentialId);
      const model = this.registry.languageModel(credential, req.model);
      return streamText({
        model,
        messages: req.messages,
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
        onAbort: () => {
          outcome.interrupted = true;
        },
      });
    })();

    async function* textStream(): AsyncGenerator<string> {
      const result = await started;
      try {
        for await (const delta of result.textStream) {
          if (firstDeltaAt === undefined && delta !== '') firstDeltaAt = clock.now().getTime();
          yield delta;
        }
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
      };
    })();
    // A caller that stops after textStream throws never awaits `final`; that is not a crash.
    final.catch(() => undefined);

    return { textStream: textStream(), final };
  }

  /** Embeds a batch in one attempt; the job queue owns retries. */
  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
    const credential = await this.resolver.resolveForUse(req.workspaceId, req.credentialId);
    const model = this.registry.embeddingModel(credential, req.model);
    try {
      const { embeddings, usage } = await embedMany({
        model,
        values: req.inputs,
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
