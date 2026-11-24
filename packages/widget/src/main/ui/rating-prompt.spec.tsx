// SPDX-License-Identifier: MIT
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RatingPrompt } from './rating-prompt';

let container: HTMLElement;

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.replaceChildren(container);
});

afterEach(() => {
  render(null, container);
});

describe('RatingPrompt', () => {
  it('offers five labelled scores and submits an optional comment', async () => {
    const onSubmit = vi.fn();
    render(<RatingPrompt submitted={false} onSubmit={onSubmit} onDismiss={vi.fn()} />, container);

    const scores = [...container.querySelectorAll<HTMLButtonElement>('[data-rating]')];
    expect(scores).toHaveLength(5);
    expect(scores.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Rate 1 out of 5',
      'Rate 2 out of 5',
      'Rate 3 out of 5',
      'Rate 4 out of 5',
      'Rate 5 out of 5',
    ]);
    scores[4]?.click();
    await settle();
    expect(scores[4]?.getAttribute('aria-pressed')).toBe('true');
    const comment = container.querySelector<HTMLTextAreaElement>('textarea');
    if (comment === null) throw new Error('rating comment field is missing');
    const submit = container.querySelector<HTMLButtonElement>('[data-primary="true"]');
    expect(submit?.disabled).toBe(false);
    comment.value = 'Fast and helpful';
    comment.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    submit?.click();

    expect(onSubmit).toHaveBeenCalledWith(5, 'Fast and helpful');
  });

  it('shows a thank-you after a successful submission and can be dismissed', () => {
    const onDismiss = vi.fn();
    render(<RatingPrompt submitted onSubmit={vi.fn()} onDismiss={onDismiss} />, container);
    expect(container.textContent).toContain('Thanks for your feedback.');

    container.querySelector<HTMLButtonElement>('[data-dismiss]')?.click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
