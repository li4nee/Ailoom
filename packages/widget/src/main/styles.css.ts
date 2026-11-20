// SPDX-License-Identifier: MIT

/**
 * The widget owns a small silver-neutral surface while its primary color and contrast color stay
 * controlled by each bot's appearance settings. All styling is contained in the Shadow Root.
 */
export const STYLES = `
  /* Hallmark · shape: app screen · genre: modern-minimal · material: charcoal, silver and lime (by request), with customer-owned widget colors · redesign: full */
  :host {
    all: initial;
    --ailoom-paper: oklch(96% 0.004 260);
    --ailoom-cotton: oklch(99% 0.002 260);
    --ailoom-ink: oklch(20% 0.008 150);
    --ailoom-ink-soft: oklch(36% 0.008 150);
    --ailoom-muted: oklch(46% 0.006 260);
    --ailoom-rule: oklch(85% 0.006 260);
    --ailoom-error: oklch(48% 0.18 28);
    --ailoom-focus: oklch(49% 0.13 130);
    --ailoom-theme: #c7f36b;
    --ailoom-text: #202820;
    color-scheme: light;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .ailoom-panel {
    position: fixed;
    right: 20px;
    bottom: 88px;
    z-index: 2147483646;
    display: flex;
    flex-direction: column;
    width: min(400px, calc(100svw - 32px));
    height: min(660px, calc(100dvh - 112px));
    max-height: min(680px, calc(100vh - 112px));
    background: var(--ailoom-paper);
    color: var(--ailoom-ink);
    border: 1px solid var(--ailoom-rule);
    border-radius: 20px;
    box-shadow: 0 24px 64px oklch(18% 0.01 40 / 20%), 0 4px 14px oklch(18% 0.01 40 / 8%);
    font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
  }
  .ailoom-panel[data-position="left"] { left: 20px; right: auto; }
  .ailoom-header {
    display: flex;
    min-height: 56px;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--ailoom-theme);
    color: var(--ailoom-text);
  }
  .ailoom-header h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow-wrap: break-word;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.25;
  }
  .ailoom-brand { display: flex; flex: 1; min-width: 0; align-items: center; gap: 10px; }
  .ailoom-avatar {
    display: grid;
    width: 40px;
    height: 40px;
    flex: 0 0 40px;
    place-items: center;
    overflow: hidden;
    border: 1px solid oklch(18% 0.008 150 / 10%);
    border-radius: 13px;
    background: oklch(100% 0 0 / 58%);
    color: var(--ailoom-ink);
    font-size: 16px;
    font-weight: 700;
  }
  .ailoom-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .ailoom-header-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; }
  .ailoom-header a { color: inherit; font-size: 12px; text-underline-offset: 3px; }
  .ailoom-human {
    min-height: 36px;
    padding: 0 10px;
    border: 1px solid oklch(18% 0.008 150 / 18%);
    border-radius: 999px;
    background: oklch(100% 0 0 / 30%);
    color: inherit;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .ailoom-human:hover { background: oklch(100% 0 0 / 52%); }
  .ailoom-icon {
    display: inline-flex;
    min-width: 40px;
    min-height: 40px;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: background-color 150ms ease-out;
  }
  .ailoom-icon:hover { background: oklch(100% 0 0 / 14%); }
  .ailoom-human:focus-visible, .ailoom-icon:focus-visible, .ailoom-header a:focus-visible { outline: 2px solid var(--ailoom-focus); outline-offset: 2px; }
  .ailoom-list {
    flex: 1;
    overflow-y: auto;
    padding: 18px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    scrollbar-color: var(--ailoom-muted) var(--ailoom-paper);
  }
  .ailoom-message {
    max-width: 88%;
    padding: 10px 12px;
    border-radius: 12px;
    overflow-wrap: anywhere;
  }
  .ailoom-message[data-role="visitor"] {
    align-self: flex-end;
    border-bottom-right-radius: 4px;
    background: var(--ailoom-theme);
    color: var(--ailoom-text);
  }
  .ailoom-message[data-role="ai"], .ailoom-message[data-role="agent"] {
    align-self: flex-start;
    border: 1px solid var(--ailoom-rule);
    border-bottom-left-radius: 4px;
    background: var(--ailoom-cotton);
  }
  .ailoom-message[data-role="system"] {
    align-self: center;
    max-width: 100%;
    background: transparent;
    color: var(--ailoom-muted);
    font-size: 12px;
    text-align: center;
  }
  .ailoom-message[data-pending="true"] { opacity: 0.7; }
  .ailoom-markdown p { margin: 0 0 8px; }
  .ailoom-markdown p:last-child { margin-bottom: 0; }
  .ailoom-markdown a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .ailoom-markdown pre {
    overflow-x: auto;
    padding: 10px;
    border-radius: 8px;
    background: var(--ailoom-ink);
    color: var(--ailoom-cotton);
  }
  .ailoom-markdown code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
  .ailoom-citations {
    display: grid;
    gap: 6px;
    margin: 12px 0 0;
    padding: 10px 0 0 20px;
    border-top: 1px solid var(--ailoom-rule);
    color: var(--ailoom-ink-soft);
    font-size: 12px;
  }
  .ailoom-citations a { color: inherit; text-decoration-thickness: 1px; text-underline-offset: 2px; }
  .ailoom-typing { padding: 2px 16px 8px; color: var(--ailoom-muted); font-size: 12px; }
  .ailoom-handoff, .ailoom-email {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-top: 1px solid var(--ailoom-rule);
    background: var(--ailoom-cotton);
  }
  .ailoom-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .ailoom-button {
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid var(--ailoom-rule);
    border-radius: 8px;
    font: inherit;
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
    transition: background-color 150ms ease-out, transform 120ms ease-out;
  }
  .ailoom-button:active { transform: translateY(1px); }
  .ailoom-button[data-primary="true"] { border-color: var(--ailoom-theme); background: var(--ailoom-theme); color: var(--ailoom-text); }
  .ailoom-button[data-primary="true"]:hover { background: color-mix(in oklch, var(--ailoom-theme) 88%, var(--ailoom-ink)); }
  .ailoom-button[data-secondary="true"] { background: var(--ailoom-paper); color: var(--ailoom-ink); }
  .ailoom-button[data-secondary="true"]:hover { background: oklch(93.5% 0.005 260); }
  .ailoom-composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 12px 14px 14px;
    border-top: 1px solid var(--ailoom-rule);
    background: var(--ailoom-cotton);
  }
  .ailoom-input {
    flex: 1;
    min-width: 0;
    min-height: 42px;
    max-height: 120px;
    resize: vertical;
    border: 1px solid var(--ailoom-rule);
    border-radius: 8px;
    background: var(--ailoom-cotton);
    color: var(--ailoom-ink);
    padding: 9px 10px;
    font: inherit;
    box-sizing: border-box;
  }
  .ailoom-input::placeholder { color: var(--ailoom-muted); opacity: 1; }
  .ailoom-send {
    min-width: 64px;
    min-height: 42px;
    padding: 0 14px;
    border: 1px solid var(--ailoom-theme);
    border-radius: 8px;
    background: var(--ailoom-theme);
    color: var(--ailoom-text);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: filter 150ms ease-out, transform 120ms ease-out;
  }
  .ailoom-send:hover:not([disabled]) { background: color-mix(in oklch, var(--ailoom-theme) 88%, var(--ailoom-ink)); }
  .ailoom-send:active:not([disabled]) { transform: translateY(1px); }
  .ailoom-send[disabled], .ailoom-button[disabled] { opacity: 0.55; cursor: not-allowed; }
  .ailoom-feedback { display: flex; gap: 6px; margin-top: 8px; }
  .ailoom-feedback button {
    min-width: 34px;
    min-height: 34px;
    border: 1px solid var(--ailoom-rule);
    border-radius: 7px;
    background: transparent;
    color: var(--ailoom-ink-soft);
    cursor: pointer;
  }
  .ailoom-feedback button[aria-pressed="true"] { border-color: var(--ailoom-theme); background: var(--ailoom-paper); color: var(--ailoom-ink); }
  .ailoom-error { color: var(--ailoom-error); font-size: 12px; }
  .ailoom-unavailable { padding: 32px 20px; color: var(--ailoom-ink-soft); text-align: center; }
  .ailoom-retry { min-height: 36px; margin-top: 6px; padding: 0 8px; border: 0; background: none; color: var(--ailoom-ink); font: inherit; font-size: 12px; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
  .ailoom-panel :focus-visible {
    outline: 2px solid var(--ailoom-focus);
    outline-offset: 2px;
  }
  @media (max-width: 480px) {
    .ailoom-panel { inset: 0; width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0; border: 0; }
    .ailoom-panel[data-position="left"] { left: 0; right: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ailoom-panel, .ailoom-panel *, .ailoom-panel *::before, .ailoom-panel *::after { transition: none; }
  }
`;

/** A constructable stylesheet where supported, a `<style>` element otherwise (spec §16.2). */
export function applyStyles(shadowRoot: ShadowRoot): void {
  if ('adoptedStyleSheets' in shadowRoot && 'CSSStyleSheet' in globalThis) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
      return;
    } catch {
      // Fall through to the element; some engines expose the API but reject construction.
    }
  }
  const style = document.createElement('style');
  style.textContent = STYLES;
  shadowRoot.append(style);
}
