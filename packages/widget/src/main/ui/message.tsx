// SPDX-License-Identifier: MIT
import { t } from '../i18n';
import { Citations, isLinkAllowedFor } from '../render/citations';
import { Markdown } from '../render/markdown';
import type { UiMessage } from '../state';
import { Feedback } from './feedback';

export interface MessageProps {
  message: UiMessage;
  feedbackEnabled: boolean;
  onRate: (messageId: string, rating: 1 | -1) => void;
  onRetry: () => void;
}

export function Message({ message, feedbackEnabled, onRate, onRetry }: MessageProps) {
  const rich = message.role === 'ai' || message.role === 'agent';
  const citations = message.citations ?? [];

  return (
    <div class="ailoom-message" data-role={message.role} data-pending={message.pending === true}>
      {rich ? (
        <Markdown source={message.content} isLinkAllowed={isLinkAllowedFor(citations)} />
      ) : (
        message.content
      )}
      {rich && citations.length > 0 && <Citations items={citations} />}
      {message.interrupted === true && (
        <div>
          <span>{t('interrupted')}</span>
          <button type="button" class="ailoom-retry" onClick={onRetry}>
            {t('retry')}
          </button>
        </div>
      )}
      {message.role === 'ai' && message.status === 'complete' && feedbackEnabled && (
        <Feedback message={message} onRate={onRate} />
      )}
    </div>
  );
}
