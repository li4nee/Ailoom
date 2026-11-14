// SPDX-License-Identifier: MIT

/** Spec §16.1: the custom element the snippet defines. */
export const WIDGET_ELEMENT = 'ailoom-chat';

export type LauncherPosition = 'right' | 'left';

/** The host element the loader creates; the API activates its button. */
export interface LauncherHost extends HTMLElement {
  activate?: () => void;
}

const STYLES = `
  :host { all: initial; }
  button {
    position: fixed;
    bottom: 20px;
    z-index: 2147483647;
    width: 56px;
    height: 56px;
    border: 0;
    border-radius: 50%;
    background: #2563eb;
    color: #ffffff;
    font: 600 13px/1 system-ui, sans-serif;
    cursor: pointer;
    box-shadow: 0 6px 24px rgb(0 0 0 / 24%);
  }
  button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
  :host([data-position='right']) button, :host(:not([data-position])) button { right: 20px; }
  :host([data-position='left']) button { left: 20px; }
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
