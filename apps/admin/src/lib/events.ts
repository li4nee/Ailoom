// SPDX-License-Identifier: AGPL-3.0-only
import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type { RealtimeEvent, RealtimeEventType } from '@app/shared';

type EventOf<T extends RealtimeEventType> = Extract<RealtimeEvent, { type: T }>;

/**
 * Query keys to refresh for an event, relative to the workspace: `connectWorkspaceEvents`
 * prefixes them with `['workspaces', workspaceId]`, so a key is `['workspaces', ws, ...rest]`.
 */
export type InvalidationMap = {
  [T in RealtimeEventType]: (event: EventOf<T>) => QueryKey[];
};

export const INVALIDATION_MAP: InvalidationMap = {
  'source.updated': (event) => [
    ['sources', event.botId],
    ['source', event.sourceId],
  ],
  'conversation.created': (event) => [
    ['conversations', event.botId],
    ['conversations', 'counts'],
    ['conversation', event.conversationId],
  ],
  'conversation.updated': (event) => [
    ['conversations', event.botId],
    ['conversations', 'counts'],
    ['conversation', event.conversationId],
  ],
  'message.created': (event) => [
    ['messages', event.conversationId],
    ['conversation', event.conversationId],
    ['conversations'],
  ],
  'internal_note.created': (event) => [['internal-notes', event.conversationId]],
  'internal_note.updated': (event) => [['internal-notes', event.conversationId]],
  'internal_note.deleted': (event) => [['internal-notes', event.conversationId]],
  'notification.created': () => [['notifications']],
  // The LISTEN connection was down: notifications sent meanwhile are gone, so nothing is
  // known to be fresh. An empty key is a prefix of every workspace query.
  resync: () => [[]],
};

/** The slice of `EventSource` this module uses, so a test can pass a fake one. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export interface WorkspaceEventsOptions {
  /** Defaults to the app's query client; pass `null` to skip invalidation. */
  queryClient?: QueryClient | null;
  /** Test seam; defaults to the browser's `EventSource`. */
  createEventSource?: (url: string) => EventSourceLike;
  /** First reconnect delay; doubles up to `maxReconnectMs` (spec §18.3). */
  initialReconnectMs?: number;
  maxReconnectMs?: number;
  /** Notification events identify their recipient; other workspace members ignore them. */
  userId?: string;
}

const INITIAL_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 30_000;

/**
 * Subscribes to the workspace event stream (spec §18.3) and invalidates the affected queries
 * on every event. `EventSource` reconnects on its own, but without backoff and without
 * giving up; here a failed connection is closed and re-opened with 0.5 s → 30 s backoff, and
 * the server emits `resync` after reconnecting so the client refetches what it missed.
 *
 * Returns the cleanup: it closes the stream and cancels a pending reconnect.
 */
export function connectWorkspaceEvents(
  workspaceId: string,
  onEvent: (event: RealtimeEvent) => void = () => undefined,
  options: WorkspaceEventsOptions = {},
): () => void {
  const queryClient = options.queryClient ?? null;
  const create =
    options.createEventSource ?? ((url: string): EventSourceLike => new EventSource(url));
  const initialReconnectMs = options.initialReconnectMs ?? INITIAL_RECONNECT_MS;
  const maxReconnectMs = options.maxReconnectMs ?? MAX_RECONNECT_MS;
  const url = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/events`;

  let closed = false;
  let source: EventSourceLike | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectMs = initialReconnectMs;

  const open = (): void => {
    if (closed) return;
    const current = create(url);
    source = current;
    current.onopen = () => {
      reconnectMs = initialReconnectMs;
    };
    current.onerror = () => {
      // Closing stops EventSource's own unbounded retries; ours backs off instead.
      current.onerror = null;
      current.close();
      if (source === current) source = null;
      scheduleReconnect();
    };
    for (const type of Object.keys(INVALIDATION_MAP) as RealtimeEventType[]) {
      current.addEventListener(type, (message) => {
        let event: RealtimeEvent;
        try {
          event = JSON.parse(message.data) as RealtimeEvent;
        } catch {
          return;
        }
        handle(event);
      });
    }
  };

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer !== null) return;
    const delay = reconnectMs;
    reconnectMs = Math.min(reconnectMs * 2, maxReconnectMs);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  };

  const handle = (event: RealtimeEvent): void => {
    if (
      event.type === 'notification.created' &&
      options.userId !== undefined &&
      event.userId !== options.userId
    )
      return;
    if (queryClient !== null) {
      const keys = INVALIDATION_MAP[event.type] as (value: RealtimeEvent) => QueryKey[];
      for (const key of keys(event)) {
        void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, ...key] });
      }
    }
    onEvent(event);
  };

  open();

  return () => {
    if (closed) return;
    closed = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    source?.close();
    source = null;
  };
}
