// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';

import { createClient } from './client';
import type { TokenStore } from './storage';
import { reconnectDelay, subscribeConversation } from './stream';

const MESSAGE = {
  id: 'm1',
  role: 'agent',
  content: 'Hello',
  citations: null,
  status: 'complete',
  feedback: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const store: TokenStore = {
  get: () => 'token',
  set: () => undefined,
  clear: () => undefined,
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe('subscribeConversation', () => {
  it('reconnects with the last event id and backs off', async () => {
    const seenIds: (string | null)[] = [];
    const signals: (AbortSignal | null)[] = [];
    const fetchImpl = vi.fn<FetchLike>((_input, init) => {
      const headers = new Headers(init?.headers);
      seenIds.push(headers.get('Last-Event-ID'));
      signals.push(init?.signal ?? null);
      if (seenIds.length === 1) {
        return Promise.resolve(
          new Response(`id: m1\nevent: message\ndata: ${JSON.stringify(MESSAGE)}\n\n`, {
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response('', { status: 500 }));
    });
    const client = createClient({
      origin: 'https://chat.example.com',
      publicKey: 'pk_live_x',
      store,
      fetchImpl,
    });
    const events: unknown[] = [];

    const unsubscribe = subscribeConversation(client, 'c1', (event) => {
      events.push(event);
    });

    await vi.waitFor(
      () => {
        expect(seenIds.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 3_000 },
    );

    expect(events[0]).toEqual({ type: 'message', message: MESSAGE });
    expect(seenIds[0]).toBeNull();
    expect(seenIds[1]).toBe('m1');

    unsubscribe();
    expect(signals.at(-1)?.aborted).toBe(true);
  });

  it('backs off exponentially with jitter up to 30 seconds', () => {
    expect(reconnectDelay(0, () => 0.5)).toBe(1_000);
    expect(reconnectDelay(1, () => 0.5)).toBe(2_000);
    expect(reconnectDelay(10, () => 0.5)).toBe(30_000);
    expect(reconnectDelay(10, () => 0)).toBe(24_000);
  });
});
