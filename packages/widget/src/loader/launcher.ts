// SPDX-License-Identifier: MIT

/** Spec §16.1: the custom element the snippet defines. */
export const WIDGET_ELEMENT = 'ailoom-chat';

export type LauncherPosition = 'right' | 'left';

/** The host element the loader creates; the API activates its button. */
export interface LauncherHost extends HTMLElement {
  activate?: () => void;
}

const STYLES = `
  :host {
    all: initial;
    --ailoom-launcher-theme: #c7f36b;
    --ailoom-launcher-text: #202820;
    --ailoom-launcher-ink: #202820;
  }
  button {
    position: fixed;
    bottom: 20px;
    z-index: 2147483647;
    width: 64px;
    height: 56px;
    border: 0;
    border-radius: 16px;
    background: var(--ailoom-launcher-theme);
    color: var(--ailoom-launcher-text);
    font: 600 13px/1 system-ui, sans-serif;
    cursor: pointer;
    box-shadow: 0 6px 20px oklch(18% 0.008 150 / 18%);
    transition: background-color 150ms ease-out, transform 120ms ease-out;
  }
  button:hover { background: color-mix(in oklch, var(--ailoom-launcher-theme) 88%, var(--ailoom-launcher-ink)); }
  button:active { transform: translateY(1px); }
  button:focus-visible { outline: 2px solid var(--ailoom-launcher-text); outline-offset: 3px; }
  :host([data-position='right']) button, :host(:not([data-position])) button { right: 20px; }
  :host([data-position='left']) button { left: 20px; }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;

/**
 * A constructable stylesheet where supported, a `<style>` element otherwise. The stylesheet API
 * keeps the launcher working on a host page whose CSP forbids inline styles (spec §16.2).
 */
function applyStyles(shadow: ShadowRoot, document: Document): void {
  if ('adoptedStyleSheets' in shadow && 'CSSStyleSheet' in globalThis) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      shadow.adoptedStyleSheets = [sheet];
      return;
    } catch {
      // Fall through to the element; some engines expose the API but reject construction.
    }
  }
  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.append(style);
}

/**
 * Defines `<ailoom-chat>` once per page (an open Shadow Root keeps the button immune to the
 * host page's CSS). A second loader script must not redefine it, hence the registry check.
 */
export function defineLauncher(registry: CustomElementRegistry): void {
  if (registry.get(WIDGET_ELEMENT) !== undefined) return;

  class AiloomChatLauncher extends HTMLElement implements LauncherHost {
    activate?: () => void;
    private built = false;

    connectedCallback(): void {
      if (this.built) return;
      this.built = true;
      const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });

      applyStyles(shadow, this.ownerDocument);

      const button = this.ownerDocument.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Open chat');
      button.textContent = 'Chat';
      button.addEventListener('click', () => {
        this.activate?.();
      });

      shadow.append(button);
    }
  }

  registry.define(WIDGET_ELEMENT, AiloomChatLauncher);
}
