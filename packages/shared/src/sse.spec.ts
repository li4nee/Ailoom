// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { readSse, type SseEvent } from './sse.js';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readSse(body, signal)) events.push(event);
  return events;
}

describe('readSse', () => {
  it('parses events split across chunks', async () => {
    const out = await collect(streamOf(['event: answer.de', 'lta\ndata: {"text":"Hi"}\n', '\n']));
    expect(out).toEqual([{ event: 'answer.delta', data: '{"text":"Hi"}', id: null }]);
  });

  it('joins multi-line data and ignores comments', async () => {
    const out = await collect(streamOf([': ping\n', 'data: one\ndata: two\n\n']));
    expect(out).toEqual([{ event: 'message', data: 'one\ntwo', id: null }]);
  });

  it('accepts CRLF and lone CR line endings', async () => {
    const out = await collect(streamOf(['event: trace\r\ndata: {}\r\n\r\n', 'id: 7\rdata: x\r\r']));
    expect(out).toEqual([
      { event: 'trace', data: '{}', id: null },
      { event: 'message', data: 'x', id: '7' },
    ]);
  });

  it('keeps a chunk boundary between CR and LF', async () => {
    const out = await collect(streamOf(['data: a\r', '\ndata: b\r\n\r\n']));
    expect(out).toEqual([{ event: 'message', data: 'a\nb', id: null }]);
  });

  it('strips one leading space from field values', async () => {
    const out = await collect(streamOf(['data:no-space\ndata:  two-spaces\n\n']));
    expect(out).toEqual([{ event: 'message', data: 'no-space\n two-spaces', id: null }]);
  });

  it('stops when the signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collect(streamOf(['data: late\n\n']), controller.signal)).rejects.toThrow();
  });
});
