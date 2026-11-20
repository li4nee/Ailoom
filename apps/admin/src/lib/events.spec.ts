// SPDX-License-Identifier: AGPL-3.0-only
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeEvent } from '@app/shared';

import { type EventSourceLike, connectWorkspaceEvents, INVALIDATION_MAP } from './events';

const WS = 'ws1';

class FakeEventSource implements EventSourceLike {
  static created: FakeEventSource[] = [];

  readonly url: string;
  readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  readonly close = vi.fn();
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.created.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: RealtimeEvent['type'], event: RealtimeEvent): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(event) } as MessageEvent<string>);
    }
  }

  fail(): void {
    this.onerror?.(new Event('error'));
  }
}

function fakeQueryClient(): { client: QueryClient; invalidate: ReturnType<typeof vi.fn> } {
  const invalidate = vi.fn(() => Promise.resolve());
  return { client: { invalidateQueries: invalidate } as unknown as QueryClient, invalidate };
}

beforeEach(() => {
  FakeEventSource.created = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('INVALIDATION_MAP', () => {
  it('maps events to query invalidations', () => {
    expect(
      INVALIDATION_MAP['source.updated']({
        type: 'source.updated',
        sourceId: 's',
        botId: 'b',
        status: 'ready',
      }),
    ).toEqual([
      ['sources', 'b'],
      ['source', 's'],
    ]);
  });

  it('invalidates everything on resync', () => {
    expect(INVALIDATION_MAP.resync({ type: 'resync' })).toEqual([[]]);
  });

  it('invalidates only the internal-notes query for note events', () => {
    expect(
      INVALIDATION_MAP['internal_note.updated']({
        type: 'internal_note.updated',
        conversationId: 'c1',
        noteId: 'n1',
      }),
    ).toEqual([['internal-notes', 'c1']]);
  });
});

describe('connectWorkspaceEvents', () => {
  it('opens the workspace stream and invalidates under the workspace prefix', () => {
    const { client, invalidate } = fakeQueryClient();
    connectWorkspaceEvents(WS, undefined, {
      queryClient: client,
      createEventSource: (url) => new FakeEventSource(url),
    });

    const [source] = FakeEventSource.created;
    expect(source?.url).toBe(`/api/v1/workspaces/${WS}/events`);

    source?.emit('source.updated', {
      type: 'source.updated',
      sourceId: 's',
      botId: 'b',
      status: 'ready',
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workspaces', WS, 'sources', 'b'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workspaces', WS, 'source', 's'] });
  });

  it('passes the event to the caller and ignores a malformed payload', () => {
    const onEvent = vi.fn();
    connectWorkspaceEvents(WS, onEvent, {
      queryClient: null,
      createEventSource: (url) => new FakeEventSource(url),
    });
    const [source] = FakeEventSource.created;

    for (const listener of source?.listeners.get('resync') ?? []) {
      listener({ data: 'not json' } as MessageEvent<string>);
    }
    expect(onEvent).not.toHaveBeenCalled();

    source?.emit('resync', { type: 'resync' });
    expect(onEvent).toHaveBeenCalledWith({ type: 'resync' });
  });

  it('reconnects with backoff and stops after cleanup', async () => {
    const stop = connectWorkspaceEvents(WS, undefined, {
      queryClient: null,
      createEventSource: (url) => new FakeEventSource(url),
    });
    expect(FakeEventSource.created).toHaveLength(1);

    FakeEventSource.created[0]?.fail();
    await vi.advanceTimersByTimeAsync(499);
    expect(FakeEventSource.created).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.created).toHaveLength(2);

    // The delay doubles: the second failure waits 1 s.
    FakeEventSource.created[1]?.fail();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeEventSource.created).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.created).toHaveLength(3);

    stop();
    FakeEventSource.created[2]?.fail();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeEventSource.created).toHaveLength(3);
    expect(FakeEventSource.created[2]?.close).toHaveBeenCalled();
  });

  it('resets the backoff once a connection opens', async () => {
    connectWorkspaceEvents(WS, undefined, {
      queryClient: null,
      createEventSource: (url) => new FakeEventSource(url),
    });

    FakeEventSource.created[0]?.fail();
    await vi.advanceTimersByTimeAsync(500);
    FakeEventSource.created[1]?.onopen?.(new Event('open'));
    FakeEventSource.created[1]?.fail();
    await vi.advanceTimersByTimeAsync(500);

    expect(FakeEventSource.created).toHaveLength(3);
  });
});
