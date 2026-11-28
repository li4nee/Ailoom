// SPDX-License-Identifier: MIT
import { useLayoutEffect, useRef } from 'preact/hooks';

import type { WidgetInteractions } from '@app/shared';

import type { UiMessage } from '../state';
import { Message } from './message';
import { WelcomeInteractions } from './welcome-interactions';

const BOTTOM_SCROLL_THRESHOLD = 64;

export interface MessageListProps {
  messages: UiMessage[];
  emptyMessage: string;
  interactions: WidgetInteractions;
  feedbackEnabled: boolean;
  onRate: (messageId: string, rating: 1 | -1) => void;
  onRetry: () => void;
  onInteractionSend: (content: string) => void;
}

/**
 * `aria-live="polite"` announces new answers without interrupting the visitor (spec §16.2).
 * An empty streaming placeholder is not a bubble: the typing indicator stands in for it.
 */
export function MessageList({
  messages,
  emptyMessage,
  interactions,
  feedbackEnabled,
  onRate,
  onRetry,
  onInteractionSend,
}: MessageListProps) {
  const list = useRef<HTMLDivElement>(null);
  const keepAtBottom = useRef(true);
  const visible = messages.filter(
    (message) =>
      !(message.role === 'ai' && message.status === 'streaming' && message.content === ''),
  );

  useLayoutEffect(() => {
    const element = list.current;
    if (element === null) return;
    if (keepAtBottom.current) element.scrollTop = element.scrollHeight;
    keepAtBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SCROLL_THRESHOLD;
  }, [messages]);

  return (
    <div
      ref={list}
      class="ailoom-list"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      onScroll={(event) => {
        const element = event.currentTarget;
        keepAtBottom.current =
          element.scrollHeight - element.scrollTop - element.clientHeight <=
          BOTTOM_SCROLL_THRESHOLD;
      }}
    >
      {visible.length === 0 ? (
        <div class="ailoom-message" data-role="ai">
          {emptyMessage}
          <WelcomeInteractions interactions={interactions} onSend={onInteractionSend} />
        </div>
      ) : (
        visible.map((message) => (
          <Message
            key={message.id}
            message={message}
            feedbackEnabled={feedbackEnabled}
            onRate={onRate}
            onRetry={onRetry}
          />
        ))
      )}
    </div>
  );
}
