// SPDX-License-Identifier: MIT

/**
 * One stylesheet for the Shadow Root. The host page's CSS cannot reach inside, and the panel
 * uses the bot's theme through two custom properties set on the panel element, so no inline
 * event handlers, `eval` or `innerHTML` are needed (spec §16.2).
 */
export const STYLES = `
  :host { all: initial; }
  .ailoom-panel {
    --ailoom-theme: #2563eb;
    --ailoom-text: #ffffff;
    position: fixed;
    right: 20px;
    bottom: 88px;
    z-index: 2147483646;
    display: flex;
    flex-direction: column;
    width: min(380px, calc(100vw - 40px));
    max-height: min(600px, calc(100vh - 120px));
    background: #ffffff;
    color: #111827;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    box-shadow: 0 18px 48px rgb(0 0 0 / 22%);
    font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
    transition: transform 160ms ease, opacity 160ms ease;
    overflow: hidden;
  }
  .ailoom-panel[data-position="left"] { left: 20px; right: auto; }
  .ailoom-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    background: var(--ailoom-theme);
    color: var(--ailoom-text);
  }
  .ailoom-header h2 { margin: 0; font-size: 15px; flex: 1; }
  .ailoom-header a { color: inherit; font-size: 12px; }
  .ailoom-icon {
    background: transparent;
    border: 0;
    color: inherit;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 6px;
  }
  .ailoom-list { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  .ailoom-message { max-width: 88%; padding: 8px 10px; border-radius: 10px; overflow-wrap: anywhere; }
  .ailoom-message[data-role="visitor"] { align-self: flex-end; background: var(--ailoom-theme); color: var(--ailoom-text); }
  .ailoom-message[data-role="ai"], .ailoom-message[data-role="agent"] { align-self: flex-start; background: #f3f4f6; }
  .ailoom-message[data-role="system"] { align-self: center; background: transparent; color: #6b7280; font-size: 12px; }
  .ailoom-message[data-pending="true"] { opacity: 0.7; }
  .ailoom-markdown p { margin: 0 0 6px; }
  .ailoom-markdown p:last-child { margin-bottom: 0; }
  .ailoom-markdown a { color: inherit; text-decoration: underline; }
  .ailoom-markdown pre { overflow-x: auto; background: #111827; color: #f9fafb; padding: 8px; border-radius: 6px; }
  .ailoom-markdown code { font-size: 12px; }
  .ailoom-citations { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: #4b5563; }
  .ailoom-typing { padding: 4px 14px 0; color: #6b7280; font-size: 12px; }
  .ailoom-handoff, .ailoom-email { padding: 10px 14px; border-top: 1px solid #e5e7eb; display: flex; flex-direction: column; gap: 6px; }
  .ailoom-actions { display: flex; gap: 8px; }
  .ailoom-button {
    border: 0;
    border-radius: 8px;
    padding: 7px 10px;
    font: inherit;
    cursor: pointer;
  }
  .ailoom-button[data-primary="true"] { background: var(--ailoom-theme); color: var(--ailoom-text); }
  .ailoom-button[data-secondary="true"] { background: #e5e7eb; color: #111827; }
  .ailoom-button:focus-visible, .ailoom-icon:focus-visible, .ailoom-input:focus-visible, .ailoom-send:focus-visible {
    outline: 3px solid #93c5fd;
    outline-offset: 2px;
  }
  .ailoom-composer { display: flex; gap: 8px; padding: 10px 14px 14px; border-top: 1px solid #e5e7eb; }
  .ailoom-input {
    flex: 1;
    min-height: 38px;
    max-height: 120px;
    resize: none;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    padding: 8px;
    font: inherit;
    box-sizing: border-box;
  }
  .ailoom-send {
    border: 0;
    border-radius: 8px;
    padding: 0 14px;
    background: var(--ailoom-theme);
    color: var(--ailoom-text);
    font: inherit;
    cursor: pointer;
  }
  .ailoom-send[disabled], .ailoom-button[disabled] { opacity: 0.5; cursor: default; }
  .ailoom-feedback { display: flex; gap: 6px; margin-top: 6px; }
  .ailoom-feedback button { background: transparent; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; }
  .ailoom-feedback button[aria-pressed="true"] { border-color: var(--ailoom-theme); background: #eff6ff; }
  .ailoom-error { color: #b91c1c; font-size: 12px; }
  .ailoom-unavailable { padding: 24px 16px; text-align: center; color: #374151; }
  .ailoom-retry { margin-top: 6px; font-size: 12px; text-decoration: underline; background: none; border: 0; padding: 0; cursor: pointer; color: inherit; }
  @media (max-width: 480px) {
    .ailoom-panel { inset: 0; width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0; border: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ailoom-panel { transition: none; }
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
`;

/** A constructable stylesheet where supported, a `<style>` element otherwise (spec §16.2). */
export function applyStyles(shadowRoot: ShadowRoot): void {
  if ('adoptedStyleSheets' in shadowRoot && 'CSSStyleSheet' in globalThis) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      shadowRoot.adoptedStyleSheets = [sheet];
      return;
    } catch {
      // Fall through to the element; some engines expose the API but reject construction.
    }
  }
  const style = document.createElement('style');
  style.textContent = STYLES;
  shadowRoot.append(style);
}
