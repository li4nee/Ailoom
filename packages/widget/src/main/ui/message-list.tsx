// SPDX-License-Identifier: MIT
import { useLayoutEffect, useRef } from 'preact/hooks';

import type { UiMessage } from '../state';
import { Message } from './message';

const BOTTOM_SCROLL_THRESHOLD = 64;

export interface MessageListProps {
  messages: UiMessage[];
  emptyMessage: string;
  feedbackEnabled: boolean;
  onRate: (messageId: string, rating: 1 | -1) => void;
  onRetry: () => void;
}

/**
 * `aria-live="polite"` announces new answers without interrupting the visitor (spec §16.2).
 * An empty streaming placeholder is not a bubble: the typing indicator stands in for it.
 */
export function MessageList({
  messages,
  emptyMessage,
  feedbackEnabled,
  onRate,
  onRetry,
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
