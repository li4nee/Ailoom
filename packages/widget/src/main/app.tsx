// SPDX-License-Identifier: MIT
import { render } from 'preact';
import { useEffect, useReducer, useRef } from 'preact/hooks';

import type { IdentifyContactRequest, WidgetConfig } from '@app/shared';

import type { MountOptions } from '../loader';
import type { WidgetEventName } from '../loader/api-queue';
import { availableLocales, loadLocale, pickLocale } from './i18n';
import { initialState, reducer, type WidgetAction, type WidgetState } from './state';
import { applyStyles } from './styles.css';
import { createClient, WidgetUnavailableError, type WidgetClient } from './transport/client';
import { subscribeConversation } from './transport/stream';
import { Panel } from './ui/panel';

export interface AppHandle {
  open(): void;
  close(): void;
  identify(identity: IdentifyContactRequest): Promise<void>;
  on(event: WidgetEventName, handler: () => void): () => void;
}

/** Rendered until the real config arrives; the panel is briefly visible only while booting. */
const FALLBACK_CONFIG: WidgetConfig = {
  displayName: 'Support',
  themeColor: '#c7f36b',
  textColor: '#202820',
  avatarUrl: null,
  position: 'right',
  welcomeMessage: 'Hi! How can I help?',
  privacyUrl: null,
  handoffEnabled: true,
  feedbackEnabled: true,
  csatEnabled: false,
  requireChallenge: false,
};

function localId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `local-${String(Date.now())}`;
  }
}

/**
 * Mounts the chat into the loader's Shadow Root and returns the open/close/on handle the loader
 * publishes on `window.AiloomChat` (spec §16.1). All conversation logic lives in the pure
 * reducer; this component only performs the effects (session, streams, handoff, feedback).
 */
export function mountApp(shadowRoot: ShadowRoot, options: MountOptions): Promise<AppHandle> {
  applyStyles(shadowRoot);
  const container = shadowRoot.ownerDocument.createElement('div');
  shadowRoot.append(container);

  const listeners = new Map<WidgetEventName, Set<() => void>>();
  const emit = (event: WidgetEventName): void => {
    for (const handler of listeners.get(event) ?? []) handler();
  };

  let dispatchRef: ((action: WidgetAction) => void) | null = null;
  let latestState: WidgetState = initialState();
  let closeRef: (() => void) | null = null;
  let identifyClient: WidgetClient | null = null;
  const pendingIdentities: {
    identity: IdentifyContactRequest;
    resolve: () => void;
    reject: (error: unknown) => void;
  }[] = [];

  const identify = (identity: IdentifyContactRequest): Promise<void> => {
    if (identifyClient !== null) return identifyClient.identify(identity);
    return new Promise<void>((resolve, reject) => {
      pendingIdentities.push({ identity, resolve, reject });
    });
  };

  function Root() {
    const [state, dispatch] = useReducer(reducer, undefined, initialState);
    const client = useRef<WidgetClient | null>(null);
    const lastVisitor = useRef<string | null>(null);

    dispatchRef = dispatch;
    latestState = state;
    closeRef = () => {
      dispatch({ type: 'closed' });
    };

    // Boot: session (creates or resumes the contact), config, then the open conversation.
    useEffect(() => {
      const alive = { current: true };
      const abort = new AbortController();
      const created = createClient({ origin: options.origin, publicKey: options.publicKey });
      client.current = created;
      void (async () => {
        try {
          const locale = pickLocale(options.locale, navigator.languages, availableLocales());
          await loadLocale(locale, options.origin);

          // Spec §10.4: ask whether this bot needs proof of work before creating a session.
          const challenge = await created.challenge();
          let solution: string | undefined;
          if (challenge !== null) {
            const { solveInWorker } = await import('../challenge/solve');
            solution = await solveInWorker(challenge, abort.signal);
          }
          await created.session(solution);
          identifyClient = created;
          for (const pending of pendingIdentities.splice(0)) {
            void created.identify(pending.identity).then(pending.resolve, pending.reject);
          }
          const config = await created.config();
          options.onAppearance?.(config.themeColor, config.textColor);
          const conversation = await created.currentConversation();
          if (!alive.current) return;
          dispatch({
            type: 'booted',
            config,
            conversationId: conversation?.id ?? null,
            status: conversation?.status ?? null,
            messages: conversation?.messages ?? [],
          });
        } catch (error: unknown) {
          for (const pending of pendingIdentities.splice(0)) pending.reject(error);
          if (alive.current) dispatch({ type: 'unavailable' });
        }
      })();
      return () => {
        alive.current = false;
        abort.abort();
      };
    }, []);

    // The live channel for the current conversation; re-subscribes when a conversation starts.
    useEffect(() => {
      const created = client.current;
      const conversationId = state.conversationId;
      if (created === null || conversationId === null) return;
      return subscribeConversation(created, conversationId, (event) => {
        if (event.type === 'message') {
          dispatch({ type: 'liveMessage', message: event.message });
          emit('message');
        } else if (event.type === 'status') {
          dispatch({ type: 'statusChanged', status: event.status });
        } else {
          // Events may have been missed while the connection was down: refetch.
          void created.currentConversation().then((conversation) => {
            if (conversation === null) return;
            dispatch({
              type: 'booted',
              config: state.config ?? FALLBACK_CONFIG,
              conversationId: conversation.id,
              status: conversation.status,
              messages: conversation.messages,
            });
          });
        }
      });
    }, [state.conversationId]);

    const send = async (content: string, appends: boolean): Promise<void> => {
      const created = client.current;
      if (created === null) return;
      lastVisitor.current = content;
      let conversationId = latestState.conversationId;
      try {
        if (conversationId === null) {
          const conversation = await created.createConversation({
            pageUrl: window.location.href,
            locale: navigator.language,
          });
          conversationId = conversation.id;
          dispatch({
            type: 'booted',
            config: latestState.config ?? FALLBACK_CONFIG,
            conversationId,
            status: conversation.status,
            messages: latestState.messages,
          });
        }

        if (appends) {
          dispatch({
            type: 'sendRequested',
            localId: localId(),
            content,
            createdAt: new Date().toISOString(),
          });
        }
        const controller = new AbortController();
        for await (const event of created.sendMessage(conversationId, content, controller.signal)) {
          dispatch({ type: 'streamEvent', event });
          if (event.type === 'answer.completed' || event.type === 'escalated') emit('message');
        }
      } catch (error) {
        if (error instanceof WidgetUnavailableError) {
          dispatch({ type: 'unavailable' });
          return;
        }
        dispatch({ type: 'streamInterrupted' });
      }
    };

    const rate = (messageId: string, rating: 1 | -1): void => {
      const created = client.current;
      if (created === null) return;
      void created
        .feedback(messageId, rating)
        .then(() => {
          dispatch({ type: 'feedbackSet', messageId, rating });
        })
        .catch(() => undefined);
    };

    const rateConversation = (score: number, comment?: string): void => {
      const created = client.current;
      const conversationId = latestState.conversationId;
      if (created === null || conversationId === null) return;
      void created
        .rateConversation(conversationId, score, comment)
        .then(() => {
          dispatch({ type: 'ratingSubmitted' });
        })
        .catch(() => undefined);
    };

    const handoffSubmit = (email?: string): void => {
      const created = client.current;
      const conversationId = latestState.conversationId;
      if (created === null || conversationId === null) return;
      void created
        .handoff(conversationId, email)
        .then((result) => {
          dispatch({ type: 'handoffConfirmed', handoffMessage: result.handoffMessage });
        })
        .catch((error: unknown) => {
          if (error instanceof WidgetUnavailableError) dispatch({ type: 'unavailable' });
        });
    };

    return (
      <Panel
        state={state}
        config={state.config ?? FALLBACK_CONFIG}
        onClose={() => {
          dispatch({ type: 'closed' });
          emit('close');
          shadowRoot.querySelector<HTMLElement>('.ailoom-launcher')?.focus();
        }}
        onSend={(content) => {
          void send(content, true);
        }}
        onRate={rate}
        onHandoff={() => {
          dispatch({ type: 'handoffRequested' });
        }}
        onHandoffSubmit={handoffSubmit}
        onConversationRate={rateConversation}
        onRatingDismiss={() => {
          dispatch({ type: 'ratingDismissed' });
        }}
        onRetry={() => {
          const content = lastVisitor.current;
          dispatch({ type: 'retry' });
          if (content !== null) void send(content, false);
        }}
      />
    );
  }

  render(<Root />, container);

  return Promise.resolve({
    open() {
      dispatchRef?.({ type: 'opened' });
      emit('open');
    },
    close() {
      closeRef?.();
      emit('close');
      const launcher = shadowRoot.querySelector<HTMLElement>('.ailoom-launcher');
      launcher?.focus();
    },
    identify,
    on(event, handler) {
      let set = listeners.get(event);
      if (set === undefined) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
  });
}
