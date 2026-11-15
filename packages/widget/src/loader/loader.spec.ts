// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WidgetAppHandle } from './api-queue';
import { installLoader } from './index';

function scriptWith(attributes: Record<string, string>): HTMLScriptElement {
  const script = document.createElement('script');
  script.src = 'https://cdn.example.com/widget.js';
  for (const [name, value] of Object.entries(attributes)) script.dataset[name] = value;
  // Detached on purpose: the loader only reads the tag's dataset and src, and appending it
  // makes happy-dom try to fetch the fake URL.
  return script;
}

function fakeHandle(): { handle: WidgetAppHandle; open: ReturnType<typeof vi.fn> } {
  const open = vi.fn();
  return {
    handle: { open, close: vi.fn(), on: vi.fn(() => () => undefined) },
    open,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  delete (window as unknown as Record<string, unknown>)['__ailoomWidgetInstalled'];
});

describe('installLoader', () => {
  it('defines the custom element once and ignores a second loader script', () => {
    const first = installLoader(scriptWith({ key: 'pk_live_a' }), {
      mountMain: vi.fn(),
    });
    const second = installLoader(scriptWith({ key: 'pk_live_b' }), {
      mountMain: vi.fn(),
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(document.querySelectorAll('ailoom-chat')).toHaveLength(1);
    expect(customElements.get('ailoom-chat')).toBeDefined();
  });

  it('loads main.js on the first open and replays the open call', async () => {
    const { handle, open } = fakeHandle();
    const mountMain = vi.fn(() => Promise.resolve(handle));
    const installed = installLoader(scriptWith({ key: 'pk_live_a' }), { mountMain });

    installed?.api.open();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mountMain).toHaveBeenCalledTimes(1);
    const call = mountMain.mock.calls[0] as unknown as [string, ShadowRoot, unknown];
    expect(call[0]).toBe('https://cdn.example.com/widget/0.1.0/main.js');
    expect(call[2]).toMatchObject({ publicKey: 'pk_live_a', position: 'right', locale: null });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('loads immediately for data-open="true"', async () => {
    const { handle, open } = fakeHandle();
    const mountMain = vi.fn(() => Promise.resolve(handle));
    installLoader(scriptWith({ key: 'pk_live_a', open: 'true' }), { mountMain });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mountMain).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('warns once and does nothing when data-key is missing', () => {
    const warn = vi.fn();
    const mountMain = vi.fn();
    const installed = installLoader(scriptWith({}), { warn, mountMain });

    expect(installed).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('data-key');
    expect(document.querySelector('ailoom-chat')).toBeNull();
    expect(mountMain).not.toHaveBeenCalled();
  });
});
