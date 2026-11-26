// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from 'preact/hooks';

import type { WidgetConfig } from '@app/shared';

import type { WidgetState } from '../state';
import { Composer } from './composer';
import { EmailCapture } from './email-capture';
import { HandoffOffer } from './handoff-offer';
import { Header } from './header';
import { MessageList } from './message-list';
import { RatingPrompt } from './rating-prompt';
import { Typing } from './typing';
import { Unavailable } from './unavailable';

export interface PanelProps {
  state: WidgetState;
  config: WidgetConfig;
  onClose: () => void;
  onSend: (content: string) => void;
  onRate: (messageId: string, rating: 1 | -1) => void;
  onHandoff: () => void;
  onHandoffSubmit: (email?: string) => void;
  onConversationRate: (score: number, comment?: string) => void;
  onRatingDismiss: () => void;
  onRetry: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled])';

/**
 * The panel is a labelled dialog with a focus trap, Escape handling and a polite live region
 * (spec §16.2). The launcher lives outside this component so the panel can start closed and
 * restore focus when it closes.
 */
export function Panel(props: PanelProps) {
  const { state, config } = props;
  const panel = useRef<HTMLDivElement>(null);
  const [dismissedOffer, setDismissedOffer] = useState<string | null>(null);

  const setPanel = (node: HTMLDivElement | null): void => {
    panel.current = node;
    if (node === null) return;
    node.style.setProperty('--ailoom-theme', config.themeColor);
    node.style.setProperty('--ailoom-text', config.textColor);
  };

  useEffect(() => {
    if (!state.open) return;
    panel.current?.querySelector('textarea')?.focus();
  }, [state.open]);

  if (!state.open) return null;

  const typing =
    state.phase === 'streaming' &&
    !state.messages.some(
      (message) =>
        message.role === 'ai' && message.status === 'streaming' && message.content !== '',
    );

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const root = panel.current;
    if (root === null) return;
    const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const offer = state.handoffOffer;
  const showOffer =
    offer !== null &&
    !state.emailPrompt &&
    dismissedOffer !== offer.messageId &&
    state.phase !== 'unavailable';
  const showRating =
    state.status === 'closed' &&
    config.csatEnabled &&
    !state.ratingSubmitted &&
    !state.ratingDismissed &&
    state.phase !== 'unavailable';

  return (
    <div
      ref={setPanel}
      class="ailoom-panel"
      data-position={config.position}
      role="dialog"
      aria-label={config.displayName}
      onKeyDown={handleKeyDown}
    >
      <Header config={config} onClose={props.onClose} onHandoff={props.onHandoff} />

      {state.phase === 'unavailable' ? (
        <Unavailable />
      ) : (
        <>
          <MessageList
            messages={state.messages}
            emptyMessage={config.welcomeMessage}
            feedbackEnabled={config.feedbackEnabled}
            onRate={props.onRate}
            onRetry={props.onRetry}
          />
          {typing && <Typing checkingTool={state.checkingTool} />}
          {showOffer && (
            <HandoffOffer
              onYes={props.onHandoff}
              onNo={() => {
                setDismissedOffer(offer.messageId);
              }}
            />
          )}
          {state.emailPrompt && <EmailCapture onSubmit={props.onHandoffSubmit} />}
          {showRating && (
            <RatingPrompt
              submitted={state.ratingSubmitted}
              onSubmit={props.onConversationRate}
              onDismiss={props.onRatingDismiss}
            />
          )}
          <Composer disabled={state.phase === 'streaming'} onSend={props.onSend} />
        </>
      )}
    </div>
  );
}
