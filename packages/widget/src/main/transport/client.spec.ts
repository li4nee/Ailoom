// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';

import { createClient, WidgetUnavailableError } from './client';
import type { TokenStore } from './storage';

const CONFIG = {
  displayName: 'Support',
  themeColor: '#2563eb',
  textColor: '#ffffff',
  avatarUrl: null,
  position: 'right' as const,
  welcomeMessage: 'Hi!',
  privacyUrl: null,
  handoffEnabled: true,
  feedbackEnabled: true,
  csatEnabled: false,
  requireChallenge: false,
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function memoryStore(): TokenStore {
  let token: string | null = null;
  return {
    get: () => token,
    set: (value) => {
      token = value;
    },
    clear: () => {
      token = null;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

describe('widget client', () => {
  it('yields typed events from the message stream', async () => {
    const sse = [
      'event: message.accepted\ndata: {"messageId":"m1","createdAt":"2026-01-01T00:00:00.000Z"}',
      '',
      'event: answer.delta\ndata: {"text":"Hello"}',
      '',
      'event: answer.completed\ndata: {"messageId":"m2","content":"Hello","citations":[]}',
      '',
      '',
    ].join('\n');
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(new Response(sse, { status: 200 })));
    const client = createClient({
      origin: 'https://chat.example.com',
      publicKey: 'pk_live_x',
      store: memoryStore(),
      fetchImpl,
    });

    const events = [];
    for await (const event of client.sendMessage('c1', 'hi', new AbortController().signal)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'message.accepted', messageId: 'm1', createdAt: '2026-01-01T00:00:00.000Z' },
      { type: 'answer.delta', text: 'Hello' },
      { type: 'answer.completed', messageId: 'm2', content: 'Hello', citations: [] },
    ]);
    const [input] = fetchImpl.mock.calls[0] ?? [];
    expect(input === undefined ? '' : urlOf(input)).toBe(
      'https://chat.example.com/api/widget/v1/conversations/c1/messages',
    );
  });

  it('re-sessions once on 401 and retries the request', async () => {
    const store = memoryStore();
    let configCalls = 0;
    const fetchImpl = vi.fn<FetchLike>((input) => {
      const url = urlOf(input);
      if (url.endsWith('/config')) {
        configCalls += 1;
        return Promise.resolve(
          configCalls === 1
            ? jsonResponse({ error: { code: 'unauthorized', message: 'expired' } }, 401)
            : jsonResponse(CONFIG),
        );
      }
      if (url.endsWith('/sessions')) {
        return Promise.resolve(jsonResponse({ token: 'fresh-token', contactId: 'contact-1' }, 201));
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
    const client = createClient({
      origin: 'https://chat.example.com',
      publicKey: 'pk_live_x',
      store,
      fetchImpl,
    });

    const config = await client.config();

    expect(config.displayName).toBe('Support');
    expect(store.get()).toBe('fresh-token');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const retriedConfig = fetchImpl.mock.calls[2] ?? [];
    expect(new Headers(retriedConfig[1]?.headers).get('authorization')).toBe('Bearer fresh-token');
    const sessionCall = fetchImpl.mock.calls[1] ?? [];
    expect(urlOf(sessionCall[0] ?? '')).toBe('https://chat.example.com/api/widget/v1/sessions');
    const body = sessionCall[1]?.body;
    if (typeof body !== 'string') throw new Error('the session request had no JSON body');
    expect(JSON.parse(body)).toMatchObject({ publicKey: 'pk_live_x' });
  });

  it('sends an identified contact through the authenticated widget route', async () => {
    const store = memoryStore();
    store.set('visitor-token');
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse({})));
    const client = createClient({
      origin: 'https://chat.example.com',
      publicKey: 'pk_live_x',
      store,
      fetchImpl,
    });

    await client.identify({
      externalId: 'customer-42',
      email: 'buyer@example.com',
      attributes: { plan: 'pro' },
    });

    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    expect(urlOf(input ?? '')).toBe('https://chat.example.com/api/widget/v1/contacts/identify');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer visitor-token');
    if (typeof init?.body !== 'string') throw new Error('the identify request had no JSON body');
    expect(JSON.parse(init.body)).toEqual({
      externalId: 'customer-42',
      email: 'buyer@example.com',
      attributes: { plan: 'pro' },
    });
  });

  it('sends one conversation rating through the authenticated route', async () => {
    const store = memoryStore();
    store.set('visitor-token');
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(new Response(null, { status: 204 })));
    const client = createClient({
      origin: 'https://chat.example.com',
      publicKey: 'pk_live_x',
      store,
      fetchImpl,
    });

    await client.rateConversation('c1', 5, 'Fast and helpful');

    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    expect(urlOf(input ?? '')).toBe(
      'https://chat.example.com/api/widget/v1/conversations/c1/rating',
    );
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer visitor-token');
    expect(init?.body).toBe(JSON.stringify({ score: 5, comment: 'Fast and helpful' }));
  });

  it('turns a 403 origin_not_allowed into WidgetUnavailableError', async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(
        jsonResponse({ error: { code: 'origin_not_allowed', message: 'blocked' } }, 403),
      ),
    );
    const client = createClient({
      origin: 'https://chat.example.com',
      publicKey: 'pk_live_x',
      store: memoryStore(),
      fetchImpl,
    });

    await expect(client.config()).rejects.toBeInstanceOf(WidgetUnavailableError);
  });
});
