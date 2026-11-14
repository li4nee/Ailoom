// SPDX-License-Identifier: MIT
import { readSse } from '@app/shared';

import type { WidgetClient } from './client';
import {
  parseLiveEvent,
  parseStreamEvent,
  type WidgetLiveEvent,
  type WidgetStreamEvent,
} from './events';

export const RECONNECT_INITIAL_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

/** Exponential backoff with ±20 % jitter, capped at 30 s (spec §16.3). */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(RECONNECT_INITIAL_MS * 2 ** attempt, RECONNECT_MAX_MS);
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** Parses the POST message stream into the typed spec §18.2 events. */
export async function* streamEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<WidgetStreamEvent> {
  for await (const frame of readSse(body, signal)) {
    const event = parseStreamEvent(frame.event, frame.data);
    if (event !== null) yield event;
  }
}

export interface SubscribeOptions {
  initialLastEventId?: string | null;
  onError?: (error: unknown) => void;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

/**
 * Subscribes to one conversation's live channel, reconnecting with backoff and sending the last
 * `id:` it saw as `Last-Event-ID`, so an agent reply sent while the widget was offline is
 * replayed rather than lost (spec §16.3, §17.9). Returns the unsubscribe function.
 */
export function subscribeConversation(
  client: WidgetClient,
  conversationId: string,
  onEvent: (event: WidgetLiveEvent) => void,
  options: SubscribeOptions = {},
): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  let lastEventId = options.initialLastEventId ?? null;
  let attempt = 0;

  const run = async (): Promise<void> => {
    for (;;) {
      try {
        const response = await client.openEvents(conversationId, lastEventId, signal);
        if (!response.ok || response.body === null) {
          throw new Error(`The live channel answered ${String(response.status)}`);
        }
        for await (const frame of readSse(response.body, signal)) {
          if (frame.id !== null) lastEventId = frame.id;
          const event = parseLiveEvent(frame.event, frame.data);
          if (event !== null) onEvent(event);
        }
        // A clean end still reconnects: proxies close idle SSE connections.
        attempt = 0;
      } catch (error) {
        if (signal.aborted) return;
        options.onError?.(error);
      }
      await pause(reconnectDelay(attempt), signal);
      if (signal.aborted) return;
      attempt += 1;
    }
  };

  void run();
  return () => {
    controller.abort();
  };
}
