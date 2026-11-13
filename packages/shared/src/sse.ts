// SPDX-License-Identifier: MIT
/** One server-sent event. `id` is the event's own `id:` field, or null when it has none. */
export interface SseEvent {
  event: string;
  data: string;
  id: string | null;
}

/**
 * Reads an SSE response body from `fetch()`, which EventSource cannot do for POST requests.
 * Follows the EventSource line rules: `\r\n`, `\n` and `\r` all terminate a line, `data:`
 * lines are joined with `\n`, comments (`:`) are ignored, and field values lose one leading
 * space. Chunk boundaries may fall anywhere, including between `\r` and `\n`.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let buffer = '';
  let event = '';
  let id: string | null = null;
  let data: string[] = [];

  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parsed = takeLines(buffer, false);
      buffer = parsed.rest;
      for (const line of parsed.lines) {
        if (line === '') {
          if (data.length > 0)
            yield { event: event === '' ? 'message' : event, data: data.join('\n'), id };
          event = '';
          id = null;
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;

        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let fieldValue = colon === -1 ? '' : line.slice(colon + 1);
        if (fieldValue.startsWith(' ')) fieldValue = fieldValue.slice(1);

        if (field === 'event') event = fieldValue;
        else if (field === 'data') data.push(fieldValue);
        else if (field === 'id' && !fieldValue.includes('\0')) id = fieldValue;
      }
    }

    // A final line may lack its terminator; process it so a truncated-but-complete event is
    // not silently dropped on connection close.
    if (buffer.length > 0) {
      for (const line of takeLines(buffer, true).lines) {
        if (line === '') continue;
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let fieldValue = colon === -1 ? '' : line.slice(colon + 1);
        if (fieldValue.startsWith(' ')) fieldValue = fieldValue.slice(1);
        if (field === 'event') event = fieldValue;
        else if (field === 'data') data.push(fieldValue);
        else if (field === 'id' && !fieldValue.includes('\0')) id = fieldValue;
      }
    }
    if (data.length > 0)
      yield { event: event === '' ? 'message' : event, data: data.join('\n'), id };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

/** Splits complete lines off `buffer`. A trailing `\r` waits unless `final` is set. */
function takeLines(buffer: string, final: boolean): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let start = 0;
  let index = 0;
  while (index < buffer.length) {
    const char = buffer[index];
    if (char === '\n') {
      lines.push(buffer.slice(start, index));
      index += 1;
      start = index;
      continue;
    }
    if (char === '\r') {
      if (index + 1 === buffer.length && !final) break;
      lines.push(buffer.slice(start, index));
      index += buffer[index + 1] === '\n' ? 2 : 1;
      start = index;
      continue;
    }
    index += 1;
  }
  return { lines, rest: buffer.slice(start) };
}
