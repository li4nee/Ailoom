// SPDX-License-Identifier: MIT
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WidgetConfig, WidgetMessage } from '@app/shared';

import { initialState, type WidgetState } from '../state';
import { STYLES } from '../styles.css';
import { EmailCapture } from './email-capture';
import { Feedback } from './feedback';
import { Panel } from './panel';

const CONFIG: WidgetConfig = {
  displayName: 'Acme Help',
  themeColor: '#0f766e',
  textColor: '#ffffff',
  avatarUrl: null,
  position: 'right',
  welcomeMessage: 'Hi!',
  privacyUrl: 'https://shop.com/privacy',
  handoffEnabled: true,
  feedbackEnabled: true,
  csatEnabled: true,
  requireChallenge: false,
  interactions: { cards: [], quickReplies: [], form: null },
};

const MESSAGE: WidgetMessage = {
  id: 'm1',
  role: 'ai',
  content: 'Thirty days.',
  citations: null,
  status: 'complete',
  feedback: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.replaceChildren(container);
});

afterEach(() => {
  render(null, container);
});

function readyState(overrides: Partial<WidgetState> = {}): WidgetState {
  return {
    ...initialState(),
    phase: 'ready',
    open: true,
    config: CONFIG,
    ...overrides,
  };
}

function drawPanel(state: WidgetState) {
  const handlers = {
    onClose: vi.fn(),
    onSend: vi.fn(),
    onRate: vi.fn(),
    onHandoff: vi.fn(),
    onHandoffSubmit: vi.fn(),
    onConversationRate: vi.fn(),
    onRatingDismiss: vi.fn(),
    onRetry: vi.fn(),
  };
  render(<Panel state={state} config={CONFIG} {...handlers} />, container);
  return handlers;
}

async function settle(): Promise<void> {
  // Preact flushes effects on the next frame; give happy-dom's rAF a moment.
  await new Promise((resolve) => {
    setTimeout(resolve, 25);
  });
}

describe('Panel', () => {
  it('is a labelled dialog that focuses the composer and applies the theme', async () => {
    drawPanel(readyState());
    await settle();

    const panel = container.querySelector('[role="dialog"]');
    expect(panel?.getAttribute('aria-label')).toBe('Acme Help');
    expect(panel?.getAttribute('style')).toContain('--ailoom-theme: #0f766e');
    expect(panel?.getAttribute('style')).toContain('--ailoom-text: #ffffff');
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    expect(container.querySelector('a[href="https://shop.com/privacy"]')).not.toBeNull();
    expect(container.textContent).toContain('Talk to a human');
  });

  it('traps Tab inside the panel and closes on Escape', async () => {
    const handlers = drawPanel(readyState());
    await settle();

    const panel = container.querySelector('[role="dialog"]');
    const send = container.querySelector<HTMLButtonElement>('.ailoom-send');
    const first = container.querySelector<HTMLElement>('.ailoom-header button');
    send?.focus();
    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);

    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the typing indicator before the first delta and announces messages politely', () => {
    drawPanel(readyState({ phase: 'streaming' }));

    expect(container.querySelector('[role="status"]')?.textContent).toContain('typing');
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('gives thumbs aria-pressed state', () => {
    render(<Feedback message={{ ...MESSAGE, feedback: 1 }} onRate={vi.fn()} />, container);

    const buttons = [...container.querySelectorAll('button')];
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the reduced-motion and mobile full-screen rules in the stylesheet', () => {
    expect(STYLES).toContain('@media (prefers-reduced-motion: reduce)');
    expect(STYLES).toContain('transition: none');
    expect(STYLES).toContain('100dvh');
    expect(STYLES).toContain('@media (max-width: 480px)');
  });

  it('hides the composer in the unavailable phase', () => {
    drawPanel(readyState({ phase: 'unavailable' }));

    expect(container.textContent).toContain('Chat is unavailable right now.');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('shows a rating prompt only for a closed conversation with CSAT enabled', () => {
    drawPanel(readyState({ status: 'closed' }));
    expect(container.textContent).toContain('How was your support experience?');
    expect(container.querySelectorAll('[data-rating]')).toHaveLength(5);

    render(
      <Panel
        state={readyState({ status: 'closed' })}
        config={{ ...CONFIG, csatEnabled: false }}
        onClose={vi.fn()}
        onSend={vi.fn()}
        onRate={vi.fn()}
        onHandoff={vi.fn()}
        onHandoffSubmit={vi.fn()}
        onConversationRate={vi.fn()}
        onRatingDismiss={vi.fn()}
        onRetry={vi.fn()}
      />,
      container,
    );
    expect(container.querySelector('.ailoom-rating')).toBeNull();
  });
});

describe('EmailCapture', () => {
  function fill(value: string): void {
    const input = container.querySelector('input');
    if (input === null) throw new Error('no email input');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function submit(): void {
    const form = container.querySelector('form');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  it('treats the email as optional and validates its format', async () => {
    const onSubmit = vi.fn();
    render(<EmailCapture onSubmit={onSubmit} />, container);

    fill('not-an-email');
    await settle();
    submit();
    await settle();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('valid email');

    fill('visitor@example.com');
    await settle();
    submit();
    expect(onSubmit).toHaveBeenCalledWith('visitor@example.com');

    const skip = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Skip',
    );
    skip?.click();
    expect(onSubmit).toHaveBeenLastCalledWith();
  });
});
