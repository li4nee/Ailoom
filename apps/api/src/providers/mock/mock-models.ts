// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';

import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { simulateReadableStream } from 'ai';
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';

/** Deterministic stand-in for a provider's tokenizer: one token per four characters. */
const approxTokens = (chars: number): number => Math.ceil(chars / 4);

function textOf(content: LanguageModelV4Prompt[number]['content']): string {
  if (typeof content === 'string') return content;
  let text = '';
  for (const part of content) if (part.type === 'text') text += part.text;
  return text;
}

function lastUserText(prompt: LanguageModelV4Prompt): string {
  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const message = prompt[i];
    if (message?.role === 'user') return textOf(message.content);
  }
  return '';
}

function toolResultText(prompt: LanguageModelV4Prompt): string | undefined {
  for (const message of prompt) {
    if (message.role !== 'tool') continue;
    for (const part of message.content) {
      if (part.type !== 'tool-result') continue;
      if (part.output.type === 'text') return part.output.value;
      if (part.output.type === 'json') return JSON.stringify(part.output.value);
    }
  }
  return undefined;
}

function firstToolCall(options: LanguageModelV4CallOptions) {
  const tool = options.tools?.[0];
  if (tool?.type !== 'function' || toolResultText(options.prompt) !== undefined) {
    return undefined;
  }
  return {
    type: 'tool-call' as const,
    toolCallId: 'mock-tool-call-1',
    toolName: tool.name,
    input: '{}',
  };
}

function promptChars(prompt: LanguageModelV4Prompt): number {
  return prompt.reduce((sum, message) => sum + textOf(message.content).length, 0);
}

function chunk(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

export interface MockLanguageModelOptions {
  /** Builds the reply from the last user message. */
  reply?: (lastUserText: string) => string;
  /** Characters per streamed delta. */
  chunkSize?: number;
  /** Delay before each delta, in milliseconds. */
  delayMs?: number;
  /** Every call throws this instead of streaming. */
  failWith?: Error;
  modelId?: string;
}

const defaultReply = (text: string): string => `Mock answer about "${text.slice(0, 40)}" [1].`;

/** A chat model that streams a canned reply; usage is `ceil(chars / 4)` for prompt and reply. */
/** Reply, usage and reported request body shared by streaming and non-streaming calls. */
function answer(
  options: LanguageModelV4CallOptions,
  reply: (lastUserText: string) => string,
  modelId: string,
): { text: string; usage: LanguageModelV4Usage; request: { body: unknown } } {
  const toolResult = toolResultText(options.prompt);
  const text =
    toolResult === undefined
      ? reply(lastUserText(options.prompt))
      : `${reply(lastUserText(options.prompt))} Tool result: ${toolResult}`;
  return {
    text,
    usage: {
      inputTokens: {
        total: approxTokens(promptChars(options.prompt)),
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: approxTokens(text.length), text: undefined, reasoning: undefined },
    },
    request: {
      body: {
        model: modelId,
        messages: options.prompt,
        max_tokens: options.maxOutputTokens,
        temperature: options.temperature,
      },
    },
  };
}

const STOP = { unified: 'stop', raw: 'stop' } as const;

/** A chat model that answers with a canned reply; usage is `ceil(chars / 4)` for prompt and reply. */
export function createMockLanguageModel(opts: MockLanguageModelOptions = {}): MockLanguageModelV4 {
  const reply = opts.reply ?? defaultReply;
  const chunkSize = Math.max(1, opts.chunkSize ?? 8);
  const delayMs = opts.delayMs ?? 0;
  const modelId = opts.modelId ?? 'mock-chat';

  return new MockLanguageModelV4({
    provider: 'mock',
    modelId,
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      if (opts.failWith !== undefined) throw opts.failWith;
      const toolCall = firstToolCall(options);
      if (toolCall !== undefined) {
        return {
          content: [toolCall],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage: {
            inputTokens: {
              total: approxTokens(promptChars(options.prompt)),
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: approxTokens(toolCall.input.length),
              text: undefined,
              reasoning: undefined,
            },
          },
          request: { body: { model: modelId, messages: options.prompt, tools: options.tools } },
          warnings: [],
        };
      }
      const { text, usage, request } = answer(options, reply, modelId);
      if (delayMs > 0) await sleep(delayMs, options.abortSignal);
      return {
        content: [{ type: 'text', text }],
        finishReason: STOP,
        usage,
        request,
        warnings: [],
      };
    },
    doStream: (options: LanguageModelV4CallOptions) => {
      if (opts.failWith !== undefined) return Promise.reject(opts.failWith);
      const { text, usage, request } = answer(options, reply, modelId);
      const toolCall = firstToolCall(options);
      if (toolCall !== undefined) {
        const chunks: LanguageModelV4StreamPart[] = [
          { type: 'stream-start', warnings: [] },
          { type: 'tool-input-start', id: toolCall.toolCallId, toolName: toolCall.toolName },
          { type: 'tool-input-delta', id: toolCall.toolCallId, delta: toolCall.input },
          { type: 'tool-input-end', id: toolCall.toolCallId },
          toolCall,
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
            usage,
          },
        ];
        return Promise.resolve({
          stream: simulateReadableStream({
            chunks,
            initialDelayInMs: delayMs,
            chunkDelayInMs: delayMs,
          }),
          request,
        });
      }
      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't0' },
        ...chunk(text, chunkSize).map((delta): LanguageModelV4StreamPart => ({
          type: 'text-delta',
          id: 't0',
          delta,
        })),
        { type: 'text-end', id: 't0' },
        { type: 'finish', finishReason: STOP, usage },
      ];
      return Promise.resolve({
        stream: simulateReadableStream({
          chunks,
          initialDelayInMs: delayMs,
          chunkDelayInMs: delayMs,
        }),
        request,
      });
    },
  });
}

/** Resolves after `ms`, or rejects with the signal's reason as soon as it aborts. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason as Error);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface MockEmbeddingModelOptions {
  /** Vector length; defaults to 384 (the local model's size). */
  dimensions?: number;
  /** Every call throws this instead of embedding. */
  failWith?: Error;
  /** Delay before answering, in milliseconds; an abort ends the wait. */
  delayMs?: number;
  modelId?: string;
}

/** A unit vector derived only from `text`: SHA-256 in counter mode, mapped to [-1, 1]. */
function hashVector(text: string, dimensions: number): number[] {
  const values: number[] = [];
  for (let block = 0; values.length < dimensions; block += 1) {
    const digest = createHash('sha256')
      .update(`${String(block)}:${text}`)
      .digest();
    for (let i = 0; i + 4 <= digest.length && values.length < dimensions; i += 4) {
      values.push(digest.readUInt32BE(i) / 0x7fffffff - 1);
    }
  }
  const norm = Math.hypot(...values);
  return norm === 0 ? values : values.map((v) => v / norm);
}

/** An embedding model with deterministic, hash-seeded unit vectors. */
export function createMockEmbeddingModel(
  opts: MockEmbeddingModelOptions = {},
): MockEmbeddingModelV4 {
  const dimensions = opts.dimensions ?? 384;
  return new MockEmbeddingModelV4({
    provider: 'mock',
    modelId: opts.modelId ?? 'mock-embed',
    maxEmbeddingsPerCall: 2048,
    supportsParallelCalls: true,
    doEmbed: async ({ values, abortSignal }) => {
      if (opts.failWith !== undefined) throw opts.failWith;
      if (opts.delayMs !== undefined) await sleep(opts.delayMs, abortSignal);
      return {
        embeddings: values.map((value) => hashVector(value, dimensions)),
        usage: { tokens: values.reduce((sum, value) => sum + approxTokens(value.length), 0) },
        warnings: [],
      };
    },
  });
}
