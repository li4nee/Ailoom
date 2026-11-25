// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/clock';
import type { AppConfig } from '../../common/config';
import type { JobsService } from '../../jobs';
import { RetentionService } from './retention.service';

interface Enqueued {
  name: string;
  payload: unknown;
  startAfter: unknown;
}

function build(
  retention: AppConfig['retention'],
  startsAt = new Date('2026-11-16T02:00:00.000Z'),
): { service: RetentionService; clock: FixedClock; calls: Enqueued[] } {
  const calls: Enqueued[] = [];
  const jobs = {
    enqueue: (
      def: { name: string },
      payload: unknown,
      opts: { startAfter?: unknown } = {},
    ): Promise<string> => {
      calls.push({ name: def.name, payload, startAfter: opts.startAfter });
      return Promise.resolve('job-id');
    },
  } as unknown as JobsService;
  const clock = new FixedClock(startsAt);
  return {
    service: new RetentionService(jobs, clock, { retention } as unknown as AppConfig),
    clock,
    calls,
  };
}

describe('RetentionService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enqueues each enabled cleanup at 03:00 UTC, staggered in seconds', async () => {
    vi.useFakeTimers();
    const { service, clock, calls } = build({
      sessionsDays: 30,
      conversationsDays: 60,
      tracesDays: 90,
    });

    service.onApplicationBootstrap();
    clock.advance(59 * 60 * 1_000);
    await vi.advanceTimersByTimeAsync(59 * 60 * 1_000);
    expect(calls).toEqual([]);

    clock.advance(60 * 1_000);
    await vi.advanceTimersByTimeAsync(60 * 1_000);
    service.onApplicationShutdown();

    expect(calls).toEqual([
      { name: 'auth.session_retention', payload: { olderThanDays: 30 }, startAfter: 0 },
      { name: 'conversation.retention', payload: { olderThanDays: 60 }, startAfter: 5 },
      { name: 'trace.retention', payload: { olderThanDays: 90 }, startAfter: 10 },
      { name: 'notification.retention', payload: {}, startAfter: 15 },
    ]);
  });

  it('skips cleanup that is disabled with 0 days', async () => {
    vi.useFakeTimers();
    const { service, clock, calls } = build({
      sessionsDays: 0,
      conversationsDays: 0,
      tracesDays: 0,
    });

    service.onApplicationBootstrap();
    clock.advance(60 * 60 * 1_000);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1_000);
    service.onApplicationShutdown();

    expect(calls).toEqual([{ name: 'notification.retention', payload: {}, startAfter: 15 }]);
  });

  it('enqueues again only at the next 03:00 UTC', async () => {
    vi.useFakeTimers();
    const { service, clock, calls } = build({
      sessionsDays: 30,
      conversationsDays: 0,
      tracesDays: 0,
    });

    service.onApplicationBootstrap();
    clock.advance(60 * 60 * 1_000);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1_000);
    expect(calls).toHaveLength(2);

    clock.advance(23 * 60 * 60 * 1_000);
    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1_000);
    expect(calls).toHaveLength(2);

    clock.advance(60 * 60 * 1_000);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1_000);
    expect(calls).toHaveLength(4);
    service.onApplicationShutdown();
  });

  it('waits for the next day when started after 03:00 UTC', async () => {
    vi.useFakeTimers();
    const { service, clock, calls } = build(
      { sessionsDays: 30, conversationsDays: 0, tracesDays: 0 },
      new Date('2026-11-16T04:00:00.000Z'),
    );

    service.onApplicationBootstrap();
    clock.advance(22 * 60 * 60 * 1_000 + 59 * 60 * 1_000);
    await vi.advanceTimersByTimeAsync(22 * 60 * 60 * 1_000 + 59 * 60 * 1_000);
    expect(calls).toHaveLength(0);

    clock.advance(60 * 1_000);
    await vi.advanceTimersByTimeAsync(60 * 1_000);
    expect(calls).toHaveLength(2);
    service.onApplicationShutdown();
  });
});
