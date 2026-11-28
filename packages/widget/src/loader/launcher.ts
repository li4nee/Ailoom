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
  .ailoom-launcher {
    position: fixed;
    bottom: max(20px, env(safe-area-inset-bottom));
    z-index: 2147483647;
    display: grid;
    place-items: center;
    width: 60px;
    height: 60px;
    border: 1px solid oklch(100% 0 0 / 72%);
    border-radius: 19px;
    background: var(--ailoom-launcher-theme);
    color: var(--ailoom-launcher-text);
    cursor: pointer;
    box-shadow: 0 12px 30px oklch(18% 0.008 150 / 22%), 0 2px 8px oklch(18% 0.008 150 / 10%);
    transition: background-color 150ms ease-out, transform 120ms ease-out;
  }
  .ailoom-launcher svg { width: 27px; height: 27px; }
  .ailoom-launcher:hover { background: color-mix(in oklch, var(--ailoom-launcher-theme) 88%, var(--ailoom-launcher-ink)); }
  .ailoom-launcher:active { transform: translateY(1px); }
  .ailoom-launcher:focus-visible { outline: 2px solid var(--ailoom-launcher-text); outline-offset: 3px; }
  :host([data-open='true']) .ailoom-launcher { display: none; }
  :host([data-position='right']) .ailoom-launcher, :host(:not([data-position])) .ailoom-launcher { right: 20px; }
  :host([data-position='left']) .ailoom-launcher { left: 20px; }
  @media (prefers-reduced-motion: reduce) { .ailoom-launcher { transition: none; } }
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
      button.className = 'ailoom-launcher';
      button.setAttribute('aria-label', 'Open chat');
      const icon = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('aria-hidden', 'true');
      const path = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.7-3.4A7.5 7.5 0 1 1 20 11.5Z');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.8');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      icon.append(path);
      button.append(icon);
      button.addEventListener('click', () => {
        this.activate?.();
      });

      shadow.append(button);
    }
  }

  registry.define(WIDGET_ELEMENT, AiloomChatLauncher);
}
