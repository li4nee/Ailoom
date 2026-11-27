// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { SystemClock } from '../../common/clock';
import type { Llm, StreamChatRequest } from '../../providers';
import { QueryRewriter } from './query-rewriter.service';

function mockLlm(output: string | Error) {
  const streamChat = vi.fn((request: StreamChatRequest) => ({
    textStream: (async function* () {
      await Promise.resolve();
      if (output instanceof Error) throw output;
      yield output;
    })(),
    final: Promise.resolve({
      inputTokens: 20,
      outputTokens: 8,
      ttftMs: 1,
      requestSnapshot: { prompt: request.messages },
    }),
    usageSnapshot: () => ({ inputTokens: 20, outputTokens: 8 }),
  }));
  return { llm: { streamChat } as unknown as Llm, streamChat };
}

const base = {
  workspaceId: '018f0a4e-7b2c-7abc-8def-0123456789ab',
  credentialId: '018f0a4e-7b2c-7abc-8def-0123456789ac',
  provider: 'mock' as const,
  model: 'mock-chat',
  visitorMessages: ['How long is the refund window?', 'And for annual plans?'],
  fallbackQuery: 'How long is the refund window?\nAnd for annual plans?',
  signal: new AbortController().signal,
};

describe('QueryRewriter', () => {
  it('rewrites follow-ups using the primary provider and returns usage without a request snapshot', async () => {
    const { llm, streamChat } = mockLlm('refund period for annual plans');
    const result = await new QueryRewriter(llm, new SystemClock()).rewrite({
      ...base,
      visitorMessages: [
        'My email is customer@example.com. What is the refund window?',
        'And for annual plans?',
      ],
    });

    expect(result).toMatchObject({
      query: 'refund period for annual plans',
      applied: true,
      failure: null,
      usage: {
        provider: 'mock',
        model: 'mock-chat',
        inputTokens: 20,
        outputTokens: 8,
      },
    });
    const request = streamChat.mock.calls[0]?.[0];
    expect(JSON.stringify(request?.messages)).toContain('[redacted email]');
    expect(JSON.stringify(request?.messages)).not.toContain('customer@example.com');
    expect(JSON.stringify(result)).not.toContain('customer@example.com');
  });

  it('keeps the deterministic query when the provider fails', async () => {
    const { llm } = mockLlm(new Error('provider detail must stay private'));
    const result = await new QueryRewriter(llm, new SystemClock()).rewrite({
      ...base,
      visitorMessages: ['Refund options for annual plan?', 'And for yearly billing?'],
    });
    expect(result).toMatchObject({
      query: base.fallbackQuery,
      applied: false,
      failure: 'unavailable',
    });
    expect(JSON.stringify(result)).not.toContain('provider detail');
  });

  it('keeps the original query when the model returns invalid output', async () => {
    const { llm } = mockLlm('{"query":"refunds"}');
    const result = await new QueryRewriter(llm, new SystemClock()).rewrite(base);
    expect(result).toMatchObject({
      query: base.fallbackQuery,
      applied: false,
      failure: 'invalid_output',
    });
  });

  it('falls back at the rewrite deadline', async () => {
    const streamChat = vi.fn((request: StreamChatRequest) => ({
      textStream: (async function* () {
        yield 'partial';
        await new Promise<void>((resolve) => {
          request.signal.addEventListener(
            'abort',
            () => {
              resolve();
            },
            { once: true },
          );
        });
        throw new Error('timed out');
      })(),
      final: new Promise<never>(() => undefined),
      usageSnapshot: () => ({ inputTokens: 0, outputTokens: 0 }),
    }));
    const rewriter = new QueryRewriter({ streamChat } as unknown as Llm, new SystemClock());
    const result = await rewriter.rewrite(base);
    expect(result).toMatchObject({
      query: base.fallbackQuery,
      applied: false,
      failure: 'timeout',
    });
  });

  it('does not call a model for ordinary questions or without prior context', async () => {
    const { llm, streamChat } = mockLlm('rewritten');
    const rewriter = new QueryRewriter(llm, new SystemClock());
    await rewriter.rewrite({ ...base, visitorMessages: ['Where is the billing page?'] });
    await rewriter.rewrite({
      ...base,
      visitorMessages: [
        'Where is the billing page?',
        'Please explain where I can manage billing settings in my customer account',
      ],
    });
    expect(streamChat).not.toHaveBeenCalled();
  });
});
