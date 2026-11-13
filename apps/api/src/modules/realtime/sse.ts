// SPDX-License-Identifier: AGPL-3.0-only
import type { NodeResponse } from '@nestjs/platform-node';

/** Default `: ping` interval (spec §18.1). */
export const DEFAULT_SSE_HEARTBEAT_MS = 20_000;

/** Nest token so tests can shorten the heartbeat. */
export const SSE_HEARTBEAT_MS = Symbol('SSE_HEARTBEAT_MS');

export interface SseStreamOptions {
  heartbeatMs?: number;
}

/** A server-sent-events response: write frames, detect the client going away, close it. */
export interface SseStream {
  send(event: string, data: unknown, id?: string): void;
  close(): void;
  onClose(callback: () => void): void;
}

/**
 * Turns `reply` into an SSE stream (spec §18.1): the headers Caddy must not buffer or
 * compress, and a `: ping` comment so an idle stream is not cut by a proxy.
 */
export function openSse(reply: NodeResponse, options: SseStreamOptions = {}): SseStream {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS;
  const closeCallbacks = new Set<() => void>();
  let closed = false;

  reply.status(200);
  reply.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  reply.flushHeaders();

  const finish = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const callback of closeCallbacks) callback();
    closeCallbacks.clear();
  };

  const heartbeat = setInterval(() => {
    if (!closed) reply.write(': ping\n\n');
  }, heartbeatMs);
  heartbeat.unref();
  reply.on('close', finish);
  reply.on('error', finish);

  return {
    send(event, data, id) {
      if (closed) return;
      const lines = id === undefined ? '' : `id: ${id}\n`;
      reply.write(`${lines}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      if (closed) return;
      finish();
      reply.end();
    },
    onClose(callback) {
      if (closed) callback();
      else closeCallbacks.add(callback);
    },
  };
}
