// SPDX-License-Identifier: MIT
import type { ConversationStatus, WidgetConfig, WidgetMessage } from '@app/shared';

import type { WidgetStreamEvent } from './transport/events';

export type WidgetPhase = 'booting' | 'challenge' | 'ready' | 'streaming' | 'unavailable' | 'error';

export type UiMessage = WidgetMessage & { pending?: boolean; interrupted?: boolean };

export interface WidgetState {
  phase: WidgetPhase;
  open: boolean;
  config: WidgetConfig | null;
  conversationId: string | null;
  status: ConversationStatus | null;
  messages: UiMessage[];
  handoffOffer: { messageId: string } | null;
  emailPrompt: boolean;
}

export type WidgetAction =
  | {
      type: 'booted';
      config: WidgetConfig;
      conversationId: string | null;
      status: ConversationStatus | null;
      messages: WidgetMessage[];
    }
  | { type: 'opened' }
  | { type: 'closed' }
  | { type: 'sendRequested'; localId: string; content: string; createdAt: string }
  | { type: 'streamEvent'; event: WidgetStreamEvent }
  | { type: 'liveMessage'; message: WidgetMessage }
  | { type: 'statusChanged'; status: ConversationStatus }
  | { type: 'handoffRequested' }
  | { type: 'handoffConfirmed'; handoffMessage: string }
  | { type: 'feedbackSet'; messageId: string; rating: 1 | -1 }
  | { type: 'unavailable' }
  | { type: 'streamInterrupted' }
  | { type: 'retry' };

export function initialState(): WidgetState {
  return {
    phase: 'booting',
    open: false,
    config: null,
    conversationId: null,
    status: null,
    messages: [],
    handoffOffer: null,
    emailPrompt: false,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled widget action: ${JSON.stringify(value)}`);
}

/** The answer currently being written: the last AI message still streaming, if any. */
function streamingIndex(messages: UiMessage[]): number {
  return messages.findLastIndex(
    (message) => message.role === 'ai' && message.status === 'streaming',
  );
}

function withMessage(messages: UiMessage[], id: string, patch: Partial<UiMessage>): UiMessage[] {
  return messages.map((message) => (message.id === id ? { ...message, ...patch } : message));
}

function streamEvent(state: WidgetState, event: WidgetStreamEvent): WidgetState {
  switch (event.type) {
    case 'message.accepted': {
      // The optimistic bubble is the last pending visitor message.
      const index = state.messages.findLastIndex(
        (message) => message.role === 'visitor' && message.pending === true,
      );
      if (index === -1) return state;
      const messages = state.messages.map((message, current) =>
        current === index ? { ...message, id: event.messageId, pending: false } : message,
      );
      return { ...state, messages };
    }

    case 'answer.started': {
      if (state.messages.some((message) => message.id === event.messageId)) {
        return { ...state, phase: 'streaming' };
      }
      const message: UiMessage = {
        id: event.messageId,
        role: 'ai',
        content: '',
        citations: null,
        status: 'streaming',
        feedback: null,
        createdAt: new Date().toISOString(),
      };
      return { ...state, phase: 'streaming', messages: [...state.messages, message] };
    }

    case 'answer.delta': {
      const index = streamingIndex(state.messages);
      if (index === -1) return state;
      const messages = state.messages.map((message, current) =>
        current === index ? { ...message, content: message.content + event.text } : message,
      );
      return { ...state, phase: 'streaming', messages };
    }

    case 'answer.completed': {
      const messages = withMessage(state.messages, event.messageId, {
        content: event.content,
        citations: event.citations,
        status: 'complete',
        interrupted: false,
      });
      return { ...state, phase: 'ready', messages };
    }

    case 'escalated': {
      const messages = withMessage(state.messages, event.messageId, {
        content: event.content,
        status: 'complete',
        interrupted: false,
      });
      return {
        ...state,
        phase: 'ready',
        messages,
        handoffOffer: event.behavior === 'offer_handoff' ? { messageId: event.messageId } : null,
      };
    }

    case 'handoff.offered':
      return {
        ...state,
        phase: 'ready',
        handoffOffer: { messageId: event.messageId },
      };

    case 'error': {
      const index = streamingIndex(state.messages);
      if (index === -1) return { ...state, phase: 'error' };
      const messages: UiMessage[] = state.messages.map((message, current) =>
        current === index ? { ...message, content: event.message, status: 'error' } : message,
      );
      return { ...state, phase: 'error', messages };
    }

    default:
      return assertNever(event);
  }
}

/**
 * The whole conversation flow as one pure reducer (spec §16.3): a session boot, the optimistic
 * visitor message, the streamed answer, dedupe between the message stream and the live channel,
 * interrupted answers, and handoff/feedback state. No I/O, no timers, no DOM.
 */
export function reducer(state: WidgetState, action: WidgetAction): WidgetState {
  switch (action.type) {
    case 'booted':
      return {
        ...state,
        phase: 'ready',
        config: action.config,
        conversationId: action.conversationId,
        status: action.status,
        messages: action.messages,
      };

    case 'opened':
      return { ...state, open: true };

    case 'closed':
      return { ...state, open: false };

    case 'sendRequested': {
      const message: UiMessage = {
        id: action.localId,
        role: 'visitor',
        content: action.content,
        citations: null,
        status: 'complete',
        feedback: null,
        createdAt: action.createdAt,
        pending: true,
      };
      return {
        ...state,
        phase: 'streaming',
        messages: [...state.messages, message],
        handoffOffer: null,
      };
    }

    case 'streamEvent':
      return streamEvent(state, action.event);

    case 'liveMessage': {
      if (state.messages.some((message) => message.id === action.message.id)) return state;
      return { ...state, messages: [...state.messages, action.message] };
    }

    case 'statusChanged':
      return {
        ...state,
        status: action.status,
        // Once an agent has the conversation, offering a handoff is noise.
        handoffOffer: action.status === 'human' ? null : state.handoffOffer,
        emailPrompt: action.status === 'human' ? false : state.emailPrompt,
      };

    case 'handoffRequested':
      return { ...state, emailPrompt: true };

    case 'handoffConfirmed':
      return {
        ...state,
        status: 'needs_human',
        emailPrompt: false,
        handoffOffer: null,
        messages: [
          ...state.messages,
          {
            id: `handoff-${String(state.messages.length)}`,
            role: 'system',
            content: action.handoffMessage,
            citations: null,
            status: 'complete',
            feedback: null,
            createdAt: new Date().toISOString(),
          },
        ],
      };

    case 'feedbackSet':
      return {
        ...state,
        messages: withMessage(state.messages, action.messageId, { feedback: action.rating }),
      };

    case 'unavailable':
      return { ...state, phase: 'unavailable' };

    case 'streamInterrupted': {
      const index = streamingIndex(state.messages);
      const messages: UiMessage[] =
        index === -1
          ? state.messages
          : state.messages.map((message, current) =>
              current === index ? { ...message, status: 'error', interrupted: true } : message,
            );
      return { ...state, phase: 'ready', messages };
    }

    case 'retry': {
      const index = state.messages.findLastIndex((message) => message.interrupted === true);
      const messages: UiMessage[] =
        index === -1
          ? state.messages
          : state.messages.map((message, current) =>
              current === index ? { ...message, interrupted: false } : message,
            );
      return { ...state, phase: 'ready', messages };
    }

    default:
      return assertNever(action);
  }
}
