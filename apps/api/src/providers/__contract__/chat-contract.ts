// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { CredentialId, WorkspaceId } from '../../db/ids';
import { ProviderError } from '../errors';
import type { Llm } from '../llm.service';
import type { StreamChatRequest, StreamChatResult } from '../types';

/** What a provider's chat contract run needs: a wired `Llm` and a model it can answer with. */
export interface ChatContractTarget {
  llm: Llm;
  credentialId: CredentialId;
  workspaceId: WorkspaceId;
  model: string;
}

export interface ChatContractOptions {
  /**
   * Skips the cases that need the provider to fail or be interrupted (today: the abort case).
   * For a live provider where such a case is not safe or cheap to run.
   */
  skipErrorCases?: boolean;
}

/** A live provider may take a while to answer; the mock finishes well inside this. */
const CASE_TIMEOUT_MS = 30_000;
/** How long an aborted stream may keep going before the contract calls it a leak. */
const ABORT_DEADLINE_MS = 1000;
const TIMED_OUT = Symbol('timed out');

/**
 * Asks for an answer long enough that the stream is still running after its first delta,
 * whatever the provider, so the abort case has something to interrupt.
 */
const LONG_ANSWER = 'Explain, in at least ten sentences, how a customer can request a refund.';
const SHORT_ANSWER = 'In one sentence, how do I request a refund?';
/** Small on purpose: reported output usage above it means the provider counted tokens twice. */
const SHORT_MAX_OUTPUT_TOKENS = 64;
const LONG_MAX_OUTPUT_TOKENS = 500;
/** No tokenizer needs more than a few tokens per character, even with chat-template overhead. */
const MAX_TOKENS_PER_PROMPT_CHAR = 4;

async function drain(stream: AsyncIterable<string>): Promise<void> {
  for await (const delta of stream) expect(delta).toBeTypeOf('string');
}

/**
 * The behavior every chat provider must have behind `Llm.streamChat`. It checks the shape of
 * the result, never the words of the reply, so the same suite runs against the mock and,
 * later, against live providers.
 */
export function runChatContract(
  name: string,
  make: () => ChatContractTarget,
  opts: ChatContractOptions = {},
): void {
  const start = (
    target: ChatContractTarget,
    prompt: string,
    maxOutputTokens: number,
    signal: AbortSignal = new AbortController().signal,
  ): StreamChatResult => {
    const request: StreamChatRequest = {
      workspaceId: target.workspaceId,
      credentialId: target.credentialId,
      model: target.model,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens,
      signal,
    };
    return target.llm.streamChat(request);
  };

  describe(`${name} chat contract`, () => {
    it(
      'concatenated deltas equal the final text',
      async () => {
        const result = start(make(), SHORT_ANSWER, SHORT_MAX_OUTPUT_TOKENS);
        const deltas: string[] = [];
        for await (const delta of result.textStream) deltas.push(delta);
        // `final` carries usage, not the text: the streamed deltas are the answer. They must
        // be whole non-empty strings that add up to a non-empty text, and the stream may
        // only end once `final` can settle.
        expect(deltas.length).toBeGreaterThan(0);
        for (const delta of deltas) {
          expect(typeof delta).toBe('string');
          expect(delta).not.toBe('');
        }
        expect(deltas.join('').trim()).not.toBe('');
        await expect(result.final).resolves.toBeDefined();
      },
      CASE_TIMEOUT_MS,
    );

    it(
      'usage is reported once with inputTokens > 0 and outputTokens > 0',
      async () => {
        const result = start(make(), SHORT_ANSWER, SHORT_MAX_OUTPUT_TOKENS);
        await drain(result.textStream);
        const usage = await result.final;
        // Positive whole numbers, inside bounds any single honest count respects: output can
        // not exceed what was allowed, input stays within a few tokens per prompt character.
        expect(Number.isInteger(usage.inputTokens)).toBe(true);
        expect(Number.isInteger(usage.outputTokens)).toBe(true);
        expect(usage.inputTokens).toBeGreaterThan(0);
        expect(usage.outputTokens).toBeGreaterThan(0);
        expect(usage.outputTokens).toBeLessThanOrEqual(SHORT_MAX_OUTPUT_TOKENS);
        expect(usage.inputTokens).toBeLessThan(SHORT_ANSWER.length * MAX_TOKENS_PER_PROMPT_CHAR);
      },
      CASE_TIMEOUT_MS,
    );

    it(
      'ttftMs is less than total latency',
      async () => {
        const startedAt = Date.now();
        const result = start(make(), SHORT_ANSWER, SHORT_MAX_OUTPUT_TOKENS);
        await drain(result.textStream);
        const { ttftMs } = await result.final;
        const latencyMs = Date.now() - startedAt;
        expect(ttftMs).toBeGreaterThanOrEqual(0);
        // Loose on purpose (real latency varies): this only rules out a ttft taken at stream end.
        expect(ttftMs).toBeLessThan(latencyMs);
      },
      CASE_TIMEOUT_MS,
    );

    it.skipIf(opts.skipErrorCases === true)(
      'aborting after the first delta ends iteration within 1000 ms and final rejects with code aborted',
      async () => {
        const controller = new AbortController();
        const result = start(make(), LONG_ANSWER, LONG_MAX_OUTPUT_TOKENS, controller.signal);
        const iterator = result.textStream[Symbol.asyncIterator]();

        const first = await iterator.next();
        expect(first.done).toBe(false);

        const abortedAt = Date.now();
        controller.abort();

        // The rest of the stream either throws or ends; it must not keep producing text.
        const drained = (async (): Promise<unknown> => {
          try {
            while (!(await iterator.next()).done) {
              // keep reading until the stream gives up
            }
            return undefined;
          } catch (error) {
            return error;
          }
        })();
        let timer: NodeJS.Timeout | undefined;
        const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => {
            resolve(TIMED_OUT);
          }, ABORT_DEADLINE_MS);
        });
        const outcome = await Promise.race([drained, deadline]);
        clearTimeout(timer);

        expect(outcome).not.toBe(TIMED_OUT);
        expect(Date.now() - abortedAt).toBeLessThan(ABORT_DEADLINE_MS);
        if (outcome !== undefined) expect(outcome).toMatchObject({ code: 'aborted' });

        const failure: unknown = await result.final.catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ProviderError);
        expect(failure).toMatchObject({ code: 'aborted' });
      },
      CASE_TIMEOUT_MS,
    );
  });
}
