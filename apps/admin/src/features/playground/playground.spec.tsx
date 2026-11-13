// SPDX-License-Identifier: AGPL-3.0-only
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { strings } from '@/strings';

import { Playground } from './components/playground';

function sseStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(inner) {
      controller = inner;
    },
  });
  return {
    body,
    push: (chunk: string) => {
      controller?.enqueue(encoder.encode(chunk));
    },
    close: () => {
      controller?.close();
    },
  };
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function stubStream(body: ReadableStream<Uint8Array>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      ),
    ),
  );
}

async function ask(question: string): Promise<void> {
  render(<Playground workspaceId="w1" botId="b1" />);
  await userEvent.type(screen.getByLabelText(strings.playground.question), question);
  await userEvent.click(screen.getByRole('button', { name: strings.playground.send }));
}

describe('playground', () => {
  it('streams text progressively, then shows sources and the trace', async () => {
    const stream = sseStream();
    stubStream(stream.body);
    await ask('What is the refund window?');

    await act(async () => {
      await Promise.resolve();
      stream.push(frame('answer.delta', { text: 'Refunds take' }));
    });
    expect(await screen.findByText('Refunds take')).toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
      stream.push(frame('answer.delta', { text: ' 30 days.' }));
      stream.push(
        frame('answer.completed', {
          messageId: 'm1',
          content: 'Refunds take 30 days.',
          citations: [
            {
              n: 1,
              chunkId: 'c1',
              documentId: 'd1',
              title: 'Refund policy',
              url: 'https://example.com/refunds',
            },
          ],
        }),
      );
      stream.push(
        frame('trace', {
          traceId: 't1',
          decision: 'answered',
          topScore: 0.912,
          inputTokens: 20,
          outputTokens: 5,
          costUsd: '0.000450',
          latencyMs: 412,
        }),
      );
      stream.close();
    });

    expect(await screen.findByText('Refunds take 30 days.')).toBeInTheDocument();
    const source = screen.getByRole('link', { name: 'Refund policy' });
    expect(source).toHaveAttribute('href', 'https://example.com/refunds');
    expect(source).toHaveAttribute('rel', 'noopener noreferrer nofollow');

    expect(screen.getByLabelText(strings.playground.trace.title)).toHaveTextContent('Answered');
    expect(screen.getByText('0.912')).toBeInTheDocument();
    expect(screen.getByText('20 / 5')).toBeInTheDocument();
    expect(screen.getByText('$0.000450')).toBeInTheDocument();
    expect(screen.getByText('412 ms')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: strings.playground.trace.openDetails }),
    ).toHaveAttribute('href', '/w/w1/bots/b1/traces/t1');
  });

  it('shows an escalation with the fallback text and reason', async () => {
    const stream = sseStream();
    stubStream(stream.body);
    await ask('Can I book a helicopter tour?');

    await act(async () => {
      await Promise.resolve();
      stream.push(
        frame('escalated', {
          messageId: 'm2',
          reason: 'top_score_below_threshold',
          behavior: 'offer_handoff',
          content: 'I could not find that. Would you like to talk to a person?',
        }),
      );
      stream.push(
        frame('trace', {
          traceId: 't2',
          decision: 'escalated',
          topScore: 0.31,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: '0',
          latencyMs: 12,
        }),
      );
      stream.close();
    });

    expect(
      await screen.findByText('I could not find that. Would you like to talk to a person?'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${strings.playground.escalation}: ${strings.playground.trace.reasons.top_score_below_threshold}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(strings.playground.trace.title)).toHaveTextContent('Escalated');
  });
});
