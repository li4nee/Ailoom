// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { widgetInteractionsSchema } from './bots.js';

const card = {
  id: 'help-center',
  title: 'Help center',
  description: 'Find common answers.',
  imageUrl: null,
  imageAlt: '',
  linkUrl: 'https://shop.example/help',
  linkLabel: 'Browse help',
};

describe('widgetInteractionsSchema', () => {
  it('accepts bounded admin-authored cards, quick replies and form fields', () => {
    expect(
      widgetInteractionsSchema.safeParse({
        cards: [card],
        quickReplies: [
          { id: 'track-order', label: 'Track an order', prompt: 'Where is my order?' },
        ],
        form: {
          title: 'Contact support',
          description: '',
          submitLabel: 'Send',
          fields: [
            { id: 'email', label: 'Email', type: 'email', required: true },
            {
              id: 'topic',
              label: 'Topic',
              type: 'select',
              required: false,
              options: ['Delivery', 'Returns'],
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects unsafe URLs, unknown action fields and oversized collections', () => {
    expect(
      widgetInteractionsSchema.safeParse({
        cards: [{ ...card, linkUrl: 'javascript:alert(1)' }],
        quickReplies: [],
        form: null,
      }).success,
    ).toBe(false);
    expect(
      widgetInteractionsSchema.safeParse({
        cards: [{ ...card, action: 'refund' }],
        quickReplies: [],
        form: null,
      }).success,
    ).toBe(false);
    expect(
      widgetInteractionsSchema.safeParse({
        cards: Array.from({ length: 9 }, (_, index) => ({ ...card, id: `card-${String(index)}` })),
        quickReplies: [],
        form: null,
      }).success,
    ).toBe(false);
  });

  it('rejects select fields with too few or too many choices', () => {
    const base = { cards: [], quickReplies: [] };
    const form = (options: string[]) => ({
      ...base,
      form: {
        title: 'Choose',
        description: '',
        submitLabel: 'Send',
        fields: [{ id: 'topic', label: 'Topic', type: 'select', required: true, options }],
      },
    });
    expect(widgetInteractionsSchema.safeParse(form(['Only one'])).success).toBe(false);
    expect(
      widgetInteractionsSchema.safeParse(
        form(Array.from({ length: 9 }, (_, index) => `Option ${String(index)}`)),
      ).success,
    ).toBe(false);
  });

  it('rejects duplicate interaction and select-option IDs', () => {
    expect(
      widgetInteractionsSchema.safeParse({
        cards: [],
        quickReplies: [
          { id: 'same', label: 'One', prompt: 'Prompt one' },
          { id: 'same', label: 'Two', prompt: 'Prompt two' },
        ],
        form: null,
      }).success,
    ).toBe(false);
    expect(
      widgetInteractionsSchema.safeParse({
        cards: [],
        quickReplies: [],
        form: {
          title: 'Choose',
          description: '',
          submitLabel: 'Send',
          fields: [
            {
              id: 'topic',
              label: 'Topic',
              type: 'select',
              required: true,
              options: ['Delivery', 'delivery'],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
