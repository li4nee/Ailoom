// SPDX-License-Identifier: MIT
import { t } from '../i18n';
import type { UiMessage } from '../state';

export interface FeedbackProps {
  message: UiMessage;
  onRate: (messageId: string, rating: 1 | -1) => void;
}

/** Two thumbs with `aria-pressed`, so a screen reader announces the current rating. */
export function Feedback({ message, onRate }: FeedbackProps) {
  return (
    <div class="ailoom-feedback">
      <button
        type="button"
        aria-label={t('helpful')}
        aria-pressed={message.feedback === 1}
        onClick={() => {
          onRate(message.id, 1);
        }}
      >
        👍
      </button>
      <button
        type="button"
        aria-label={t('notHelpful')}
        aria-pressed={message.feedback === -1}
        onClick={() => {
          onRate(message.id, -1);
        }}
      >
        👎
      </button>
    </div>
  );
}
