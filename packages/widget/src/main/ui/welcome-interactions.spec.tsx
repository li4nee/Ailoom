// SPDX-License-Identifier: MIT
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WidgetInteractions } from '@app/shared';

import { WelcomeInteractions } from './welcome-interactions';

const INTERACTIONS: WidgetInteractions = {
  cards: [
    {
      id: 'shipping',
      title: 'Shipping help',
      description: 'Track an order or read delivery times.',
      imageUrl: null,
      imageAlt: '',
      linkUrl: 'https://shop.example/help/shipping',
      linkLabel: 'Open guide',
    },
    {
      id: 'returns',
      title: 'Returns',
      description: 'Read the returns policy.',
      imageUrl: null,
      imageAlt: '',
      linkUrl: 'https://shop.example/help/returns',
      linkLabel: 'View policy',
    },
  ],
  quickReplies: [{ id: 'order', label: 'Where is my order?', prompt: 'Help me find my order.' }],
  form: {
    title: 'Contact support',
    description: 'Tell us what happened.',
    submitLabel: 'Send to support',
    fields: [
      { id: 'email', label: 'Email', type: 'email', required: true },
      {
        id: 'reason',
        label: 'Reason',
        type: 'select',
        required: true,
        options: ['Delivery', 'Refund'],
      },
    ],
  },
};

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.replaceChildren(container);
});

afterEach(() => {
  render(null, container);
});

describe('WelcomeInteractions', () => {
  it.each([
    { width: 375, height: 812 },
    { width: 1440, height: 900 },
  ])(
    'keeps links, quick replies and form controls accessible at $width×$height',
    ({ width, height }) => {
      window.innerWidth = width;
      window.innerHeight = height;
      render(<WelcomeInteractions interactions={INTERACTIONS} onSend={vi.fn()} />, container);

      expect(container.querySelector('[aria-label="Helpful links carousel"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Next links"]')).not.toBeNull();
      expect(container.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(container.querySelector('button')?.textContent).toBe('‹');
      expect(
        container.querySelector('input[type="email"]')?.getAttribute('required'),
      ).not.toBeNull();
      expect(container.querySelector('.ailoom-interaction-disclosure')?.textContent).toContain(
        'Don’t include passwords',
      );
    },
  );

  it('sends only the configured quick-reply prompt', () => {
    const onSend = vi.fn();
    render(<WelcomeInteractions interactions={INTERACTIONS} onSend={onSend} />, container);
    const quickReply = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Where is my order?',
    );

    quickReply?.click();
    expect(onSend).toHaveBeenCalledWith('Help me find my order.');
  });

  it('validates the form in the browser and sends bounded labeled answers', async () => {
    const onSend = vi.fn();
    render(<WelcomeInteractions interactions={INTERACTIONS} onSend={onSend} />, container);
    const email = container.querySelector<HTMLInputElement>('input[type="email"]');
    const reason = container.querySelector<HTMLSelectElement>('select');
    const form = container.querySelector('form');
    if (email === null || reason === null || form === null)
      throw new Error('Expected form controls');

    email.value = 'visitor@example.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    reason.value = 'Refund';
    reason.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(onSend).toHaveBeenCalledWith(
      'Contact support\nEmail: visitor@example.com\nReason: Refund',
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'added to the conversation',
    );
  });
});
