// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import type { WidgetMessage } from '@app/shared';

import { initialState, reducer, type WidgetState } from './state';

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
  requireChallenge: false,
};

function state(): WidgetState {
  return reducer(initialState(), {
    type: 'booted',
    config: CONFIG,
    conversationId: 'c1',
    status: 'ai',
    messages: [],
  });
}

function message(overrides: Partial<WidgetMessage> = {}): WidgetMessage {
  return {
    id: 'm1',
    role: 'agent',
    content: 'Hello',
    citations: null,
    status: 'complete',
    feedback: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('widget reducer', () => {
  it('adds a pending visitor message on send', () => {
    const next = reducer(state(), {
      type: 'sendRequested',
      localId: 'local-1',
      content: 'Where is my order?',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(next.phase).toBe('streaming');
    expect(next.messages).toEqual([
      expect.objectContaining({ id: 'local-1', role: 'visitor', pending: true }),
    ]);
  });

  it('replaces the pending id when the message is accepted', () => {
    const pending = reducer(state(), {
      type: 'sendRequested',
      localId: 'local-1',
      content: 'Hi',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const next = reducer(pending, {
      type: 'streamEvent',
      event: {
        type: 'message.accepted',
        messageId: 'server-1',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    });

    expect(next.messages[0]).toMatchObject({ id: 'server-1', pending: false });
  });

  it('appends every delta to one AI message', () => {
    const started = reducer(state(), {
      type: 'streamEvent',
      event: { type: 'answer.started', messageId: 'ai-1' },
    });
    const first = reducer(started, {
      type: 'streamEvent',
      event: { type: 'answer.delta', text: 'Our refund ' },
    });
    const second = reducer(first, {
      type: 'streamEvent',
      event: { type: 'answer.delta', text: 'window is 30 days.' },
    });

    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]).toMatchObject({
      id: 'ai-1',
      content: 'Our refund window is 30 days.',
      status: 'streaming',
    });
  });

  it('sets citations and leaves streaming on completion', () => {
    const started = reducer(state(), {
      type: 'streamEvent',
      event: { type: 'answer.started', messageId: 'ai-1' },
    });
    const next = reducer(started, {
      type: 'streamEvent',
      event: {
        type: 'answer.completed',
        messageId: 'ai-1',
        content: 'Thirty days.',
        citations: [{ n: 1, chunkId: 'chunk', documentId: 'doc', title: 'Refunds', url: null }],
      },
    });

    expect(next.phase).toBe('ready');
    expect(next.messages[0]).toMatchObject({
      content: 'Thirty days.',
      status: 'complete',
      citations: [expect.objectContaining({ n: 1, title: 'Refunds' })],
    });
  });

  it('offers a handoff when an escalation asks to', () => {
    const next = reducer(state(), {
      type: 'streamEvent',
      event: {
        type: 'escalated',
        messageId: 'ai-1',
        reason: 'no_knowledge',
        behavior: 'offer_handoff',
        content: 'No answer.',
      },
    });

    expect(next.handoffOffer).toEqual({ messageId: 'ai-1' });
    expect(next.phase).toBe('ready');
  });

  it('sets the handoff offer from a handoff-intent event', () => {
    const next = reducer(state(), {
      type: 'streamEvent',
      event: { type: 'handoff.offered', messageId: 'm1', reason: 'handoff_intent' },
    });

    expect(next.handoffOffer).toEqual({ messageId: 'm1' });
  });

  it('ignores a live message whose id is already present', () => {
    const booted = reducer(initialState(), {
      type: 'booted',
      config: CONFIG,
      conversationId: 'c1',
      status: 'ai',
      messages: [message({ id: 'dup' })],
    });

    const next = reducer(booted, {
      type: 'liveMessage',
      message: message({ id: 'dup', content: 'from the live channel' }),
    });

    expect(next).toBe(booted);
  });

  it('marks a partial answer interrupted and returns to ready', () => {
    const started = reducer(state(), {
      type: 'streamEvent',
      event: { type: 'answer.started', messageId: 'ai-1' },
    });
    const partial = reducer(started, {
      type: 'streamEvent',
      event: { type: 'answer.delta', text: 'partial' },
    });

    const next = reducer(partial, { type: 'streamInterrupted' });

    expect(next.phase).toBe('ready');
    expect(next.messages[0]).toMatchObject({ interrupted: true, content: 'partial' });
  });

  it('offers a retry when the stream fails before the answer starts', () => {
    const sent = reducer(state(), {
      type: 'sendRequested',
      localId: 'visitor-1',
      content: 'hello',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const interrupted = reducer(sent, { type: 'streamInterrupted' });
    expect(interrupted.phase).toBe('ready');
    expect(interrupted.messages.at(-1)).toMatchObject({
      role: 'ai',
      interrupted: true,
      content: '',
    });

    const retried = reducer(interrupted, { type: 'retry' });
    expect(retried.messages.some((message) => message.interrupted === true)).toBe(false);
    expect(retried.messages.some((message) => message.role === 'ai')).toBe(false);
  });

  it('hides the handoff offer once an agent has the conversation', () => {
    const offered = reducer(state(), {
      type: 'streamEvent',
      event: { type: 'handoff.offered', messageId: 'm1', reason: 'handoff_intent' },
    });

    const next = reducer(offered, { type: 'statusChanged', status: 'human' });

    expect(next.handoffOffer).toBeNull();
    expect(next.status).toBe('human');
  });

  it('enters the unavailable phase', () => {
    const next = reducer(state(), { type: 'unavailable' });

    expect(next.phase).toBe('unavailable');
  });
});
