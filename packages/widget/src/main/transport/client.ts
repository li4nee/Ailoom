// SPDX-License-Identifier: MIT
import type {
  ConversationMetadata,
  ConversationStatus,
  IdentifyContactRequest,
  SessionResponse,
  WidgetConfig,
  WidgetConversation,
} from '@app/shared';

import type { AltchaChallenge } from '../../challenge/solve';
import type { WidgetStreamEvent } from './events';
import { tokenStore, type TokenStore } from './storage';
import { streamEvents } from './stream';

/** The bot no longer accepts this page (origin removed, bot deleted): show "unavailable". */
export class WidgetUnavailableError extends Error {
  constructor() {
    super('Chat is unavailable right now.');
    this.name = 'WidgetUnavailableError';
  }
}

export interface WidgetApiError extends Error {
  status: number;
  code: string | null;
}

function apiError(status: number, code: string | null, message: string): WidgetApiError {
  const error = new Error(message) as WidgetApiError;
  error.status = status;
  error.code = code;
  return error;
}

async function errorFrom(response: Response): Promise<WidgetApiError> {
  let code: string | null = null;
  let message = `Request failed with ${String(response.status)}`;
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const envelope = (body as { error?: { code?: unknown; message?: unknown } }).error;
      if (typeof envelope?.code === 'string') code = envelope.code;
      if (typeof envelope?.message === 'string') message = envelope.message;
    }
  } catch {
    // A non-JSON error body keeps the status-based message.
  }
  return apiError(response.status, code, message);
}

export interface CreateClientOptions {
  origin: string;
  publicKey: string;
  store?: TokenStore;
  /** Test seam; the widget uses the page's `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface WidgetClient {
  /** `null` means the bot does not require proof of work (204 from the challenge route). */
  challenge(): Promise<AltchaChallenge | null>;
  session(challenge?: string): Promise<SessionResponse>;
  identify(identity: IdentifyContactRequest): Promise<void>;
  config(): Promise<WidgetConfig>;
  currentConversation(): Promise<WidgetConversation | null>;
  createConversation(metadata?: ConversationMetadata): Promise<WidgetConversation>;
  sendMessage(
    conversationId: string,
    content: string,
    signal: AbortSignal,
  ): AsyncIterable<WidgetStreamEvent>;
  handoff(
    conversationId: string,
    email?: string,
  ): Promise<{ status: ConversationStatus; handoffMessage: string }>;
  feedback(messageId: string, rating: 1 | -1): Promise<void>;
  /** For the live channel; the caller parses the SSE with `readSse`. */
  openEvents(
    conversationId: string,
    lastEventId: string | null,
    signal: AbortSignal,
  ): Promise<Response>;
}

/**
 * The widget's view of the API (spec §17.9): JSON calls plus the two SSE streams, authenticated
 * with the visitor token from storage. A 401 means the token expired or the contact was
 * removed, so the client re-creates one session and retries exactly once; a 403
 * `origin_not_allowed` becomes `WidgetUnavailableError` so the UI can say chat is unavailable
 * instead of showing a broken conversation.
 */
export function createClient(options: CreateClientOptions): WidgetClient {
  const base = `${options.origin.replace(/\/+$/, '')}/api/widget/v1`;
  const store = options.store ?? tokenStore(options.publicKey);
  const doFetch = options.fetchImpl ?? fetch;

  async function request(
    path: string,
    init: RequestInit,
    authenticated: boolean,
    retried = false,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    if (authenticated) {
      const token = store.get();
      if (token !== null) headers.set('Authorization', `Bearer ${token}`);
    }
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers,
      credentials: 'omit',
    });

    if (response.status === 403) {
      let code: string | null = null;
      try {
        const body: unknown = await response.clone().json();
        const envelope = (body as { error?: { code?: unknown } }).error;
        if (typeof envelope?.code === 'string') code = envelope.code;
      } catch {
        // Not the JSON envelope; the caller sees the plain error.
      }
      if (code === 'origin_not_allowed') throw new WidgetUnavailableError();
    }

    if (response.status === 401 && authenticated && !retried) {
      await client.session();
      // Retry once with the fresh token; still authenticated so the header is set this time.
      return request(path, init, true, true);
    }
    return response;
  }

  async function json(response: Response): Promise<unknown> {
    if (!response.ok) throw await errorFrom(response);
    return response.json();
  }

  /**
   * The API is the same deployment this bundle was served from, and it validates on the way
   * out. The widget checks only the fields it indexes, which keeps Zod (and its weight) out of
   * the 25 KB main bundle.
   */
  function objectOf(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null) throw new Error('Unexpected API response.');
    return value as Record<string, unknown>;
  }

  const client: WidgetClient = {
    async challenge() {
      const response = await request(
        `/challenge?k=${encodeURIComponent(options.publicKey)}`,
        { method: 'GET' },
        false,
      );
      if (response.status === 204) return null;
      if (!response.ok) throw await errorFrom(response);
      return objectOf(await response.json()) as unknown as AltchaChallenge;
    },

    async session(challenge) {
      const token = store.get();
      const response = await request(
        '/sessions',
        {
          method: 'POST',
          body: JSON.stringify({
            publicKey: options.publicKey,
            ...(token === null ? {} : { token }),
            ...(challenge === undefined ? {} : { challenge }),
          }),
        },
        false,
      );
      const parsed = objectOf(await json(response));
      if (typeof parsed['token'] !== 'string' || typeof parsed['contactId'] !== 'string') {
        throw new Error('Unexpected session response.');
      }
      const session = parsed as unknown as SessionResponse;
      store.set(session.token);
      return session;
    },

    async identify(identity) {
      const response = await request(
        '/contacts/identify',
        { method: 'POST', body: JSON.stringify(identity) },
        true,
      );
      await json(response);
    },

    async config() {
      const response = await request('/config', { method: 'GET' }, true);
      return objectOf(await json(response)) as unknown as WidgetConfig;
    },

    async currentConversation() {
      const response = await request('/conversations/current', { method: 'GET' }, true);
      const body = await json(response);
      return body === null ? null : (objectOf(body) as unknown as WidgetConversation);
    },

    async createConversation(metadata) {
      const response = await request(
        '/conversations',
        {
          method: 'POST',
          body: JSON.stringify(metadata === undefined ? {} : { metadata }),
        },
        true,
      );
      return objectOf(await json(response)) as unknown as WidgetConversation;
    },

    async *sendMessage(conversationId, content, signal) {
      const response = await request(
        `/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content }),
          signal,
          headers: { Accept: 'text/event-stream' },
        },
        true,
      );
      if (!response.ok) throw await errorFrom(response);
      if (response.body === null) return;
      yield* streamEvents(response.body, signal);
    },

    async handoff(conversationId, email) {
      const response = await request(
        `/conversations/${encodeURIComponent(conversationId)}/handoff`,
        {
          method: 'POST',
          body: JSON.stringify(email === undefined ? {} : { email }),
        },
        true,
      );
      const body = (await json(response)) as {
        status: ConversationStatus;
        handoffMessage: string;
      };
      return { status: body.status, handoffMessage: body.handoffMessage };
    },

    async feedback(messageId, rating) {
      const response = await request(
        `/messages/${encodeURIComponent(messageId)}/feedback`,
        { method: 'POST', body: JSON.stringify({ rating }) },
        true,
      );
      if (!response.ok) throw await errorFrom(response);
    },

    async openEvents(conversationId, lastEventId, signal) {
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (lastEventId !== null) headers['Last-Event-ID'] = lastEventId;
      return request(
        `/conversations/${encodeURIComponent(conversationId)}/events`,
        { method: 'GET', headers, signal },
        true,
      );
    },
  };

  return client;
}
