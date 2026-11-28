// SPDX-License-Identifier: MIT
import { useRef, useState } from 'preact/hooks';

import { WIDGET_MESSAGE_MAX_LENGTH, type WidgetInteractions } from '@app/shared';

export function WelcomeInteractions({
  interactions,
  onSend,
}: {
  interactions: WidgetInteractions;
  onSend: (content: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = interactions.form;

  const submitForm = (event: SubmitEvent): void => {
    event.preventDefault();
    if (form === null) return;
    const answer = form.fields
      .map((field) => `${field.label}: ${(values[field.id] ?? '').trim()}`)
      .join('\n');
    const content = `${form.title}\n${answer}`.trim();
    if (content.length > WIDGET_MESSAGE_MAX_LENGTH) {
      setFormError('Please shorten your answers before sending.');
      return;
    }
    setSubmitted(true);
    onSend(content);
  };

  if (interactions.cards.length === 0 && interactions.quickReplies.length === 0 && form === null) {
    return null;
  }

  return (
    <div class="ailoom-interactions">
      {interactions.cards.length > 0 && (
        <section aria-label="Helpful links" class="ailoom-card-section">
          {interactions.cards.length > 1 && (
            <div class="ailoom-carousel-controls">
              <span>Helpful links</span>
              <div>
                <button
                  type="button"
                  aria-label="Previous links"
                  onClick={() => {
                    scrollCards(-240);
                  }}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next links"
                  onClick={() => {
                    scrollCards(240);
                  }}
                >
                  ›
                </button>
              </div>
            </div>
          )}
          <div
            ref={rail}
            class="ailoom-card-rail"
            role={interactions.cards.length > 1 ? 'region' : undefined}
            aria-label={interactions.cards.length > 1 ? 'Helpful links carousel' : undefined}
          >
            {interactions.cards.map((card) => (
              <article key={card.id} class="ailoom-interaction-card">
                {card.imageUrl !== null && (
                  <img src={card.imageUrl} alt={card.imageAlt} loading="lazy" />
                )}
                <h3>{card.title}</h3>
                {card.description && <p>{card.description}</p>}
                <a href={card.linkUrl} target="_blank" rel="noopener noreferrer">
                  {card.linkLabel}
                  <span class="ailoom-sr-only"> (opens in a new tab)</span>
                </a>
              </article>
            ))}
          </div>
        </section>
      )}
      {interactions.quickReplies.length > 0 && (
        <section class="ailoom-quick-replies" aria-label="Suggested questions">
          {interactions.quickReplies.map((reply) => (
            <button
              key={reply.id}
              type="button"
              onClick={() => {
                onSend(reply.prompt);
              }}
            >
              {reply.label}
            </button>
          ))}
        </section>
      )}
      {form !== null && !submitted && (
        <form class="ailoom-interaction-form" onSubmit={submitForm}>
          <div>
            <h3>{form.title}</h3>
            {form.description && <p>{form.description}</p>}
          </div>
          {form.fields.map((field) => (
            <label key={field.id}>
              <span>
                {field.label}
                {field.required && <span aria-hidden="true"> *</span>}
              </span>
              {field.type === 'select' ? (
                <select
                  required={field.required}
                  value={values[field.id] ?? ''}
                  onChange={(event) => {
                    setValues({ ...values, [field.id]: event.currentTarget.value });
                  }}
                >
                  <option value="">Choose an option</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === 'email' ? (
                <input
                  type="email"
                  required={field.required}
                  maxLength={254}
                  value={values[field.id] ?? ''}
                  onInput={(event) => {
                    setValues({ ...values, [field.id]: event.currentTarget.value });
                  }}
                />
              ) : (
                <input
                  type="text"
                  required={field.required}
                  maxLength={500}
                  value={values[field.id] ?? ''}
                  onInput={(event) => {
                    setValues({ ...values, [field.id]: event.currentTarget.value });
                  }}
                />
              )}
            </label>
          ))}
          <p class="ailoom-interaction-disclosure">
            Your answers are added to this conversation and processed by the support team and
            configured AI. Don’t include passwords or payment details.
          </p>
          {formError !== null && (
            <p role="alert" class="ailoom-error">
              {formError}
            </p>
          )}
          <button type="submit">{form.submitLabel}</button>
        </form>
      )}
      {submitted && (
        <p class="ailoom-interaction-confirmation" role="status">
          Your details were added to the conversation.
        </p>
      )}
    </div>
  );

  function scrollCards(left: number): void {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rail.current?.scrollBy({ left, behavior: reduceMotion ? 'instant' : 'smooth' });
  }
}
