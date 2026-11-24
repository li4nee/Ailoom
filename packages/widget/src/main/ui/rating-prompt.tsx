// SPDX-License-Identifier: MIT
import { useState } from 'preact/hooks';

import { t } from '../i18n';

export interface RatingPromptProps {
  submitted: boolean;
  onSubmit: (score: number, comment?: string) => void;
  onDismiss: () => void;
}

/** Keyboard and screen-reader accessible 1–5 conversation rating prompt. */
export function RatingPrompt({ submitted, onSubmit, onDismiss }: RatingPromptProps) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');

  return (
    <section class="ailoom-rating" aria-label={t('ratingPrompt')}>
      {submitted ? (
        <p role="status">{t('ratingThankYou')}</p>
      ) : (
        <>
          <fieldset class="ailoom-rating-fieldset">
            <legend>{t('ratingPrompt')}</legend>
            <div class="ailoom-rating-scores">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  data-rating={String(value)}
                  aria-label={t('ratingScore', { score: value })}
                  aria-pressed={score === value}
                  onClick={() => {
                    setScore(value);
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            <span>{t('ratingComment')}</span>
            <textarea
              class="ailoom-input"
              maxLength={1000}
              placeholder={t('ratingCommentPlaceholder')}
              value={comment}
              onInput={(event) => {
                setComment(event.currentTarget.value);
              }}
            />
          </label>
          <button
            class="ailoom-button"
            data-primary="true"
            type="button"
            disabled={score === null}
            onClick={() => {
              if (score === null) return;
              const trimmed = comment.trim();
              onSubmit(score, trimmed === '' ? undefined : trimmed);
            }}
          >
            {t('ratingSubmit')}
          </button>
        </>
      )}
      <button type="button" data-dismiss onClick={onDismiss}>
        {t('ratingDismiss')}
      </button>
    </section>
  );
}
