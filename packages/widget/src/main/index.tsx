// SPDX-License-Identifier: MIT
import { render } from 'preact';

import type { MountOptions } from '../loader';
import type { WidgetEventName } from '../loader/api-queue';

export interface AppHandle {
  open(): void;
  close(): void;
  on(event: WidgetEventName, handler: () => void): () => void;
}

/**
 * Mounts the chat into the loader's Shadow Root (Task 5.8 placeholder; Task 5.12 replaces it
 * with the real panel). Kept small and event-compatible so the loader's queue can be wired and
 * tested independently of the UI.
 */
export function mountApp(shadowRoot: ShadowRoot, options: MountOptions): Promise<AppHandle> {
  const document = shadowRoot.ownerDocument;
  const container = document.createElement('div');
  container.dataset['widget'] = 'ailoom';
  shadowRoot.append(container);

  const handlers = new Map<WidgetEventName, Set<() => void>>();
  const emit = (event: WidgetEventName): void => {
    for (const handler of handlers.get(event) ?? []) handler();
  };
  let open = false;

  const draw = (): void => {
    render(
      <div
        class="ailoom-panel"
        role="dialog"
        aria-label="Support chat"
        hidden={!open}
        style={{
          position: 'fixed',
          inset: 'auto 20px 88px 20px',
          maxHeight: '70vh',
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '16px',
          font: '14px/1.5 system-ui, sans-serif',
        }}
      >
        <p>Hi! How can I help?</p>
        <p style={{ color: '#6b7280' }}>Connecting to {options.origin}…</p>
      </div>,
      container,
    );
  };

  return Promise.resolve({
    open() {
      if (open) return;
      open = true;
      draw();
      emit('open');
    },
    close() {
      if (!open) return;
      open = false;
      draw();
      emit('close');
    },
    on(event, handler) {
      let set = handlers.get(event);
      if (set === undefined) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
  });
}
