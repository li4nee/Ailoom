// SPDX-License-Identifier: MIT
import type { UiMessage } from '../state';
import { Message } from './message';

export interface MessageListProps {
  messages: UiMessage[];
  feedbackEnabled: boolean;
  onRate: (messageId: string, rating: 1 | -1) => void;
  onRetry: () => void;
}

/**
 * `aria-live="polite"` announces new answers without interrupting the visitor (spec §16.2).
 * An empty streaming placeholder is not a bubble: the typing indicator stands in for it.
 */
export function MessageList({ messages, feedbackEnabled, onRate, onRetry }: MessageListProps) {
  const visible = messages.filter(
    (message) =>
      !(message.role === 'ai' && message.status === 'streaming' && message.content === ''),
  );

  return (
    <div class="ailoom-list" role="log" aria-live="polite" aria-relevant="additions text">
      {visible.map((message) => (
        <Message
          key={message.id}
          message={message}
          feedbackEnabled={feedbackEnabled}
          onRate={onRate}
          onRetry={onRetry}
        />
      ))}
    </div>
  );
}
