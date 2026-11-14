// SPDX-License-Identifier: MIT
import { WIDGET_VERSION } from '../version';
import { createApi, type WidgetApi, type WidgetAppHandle } from './api-queue';
import {
  defineLauncher,
  WIDGET_ELEMENT,
  type LauncherHost,
  type LauncherPosition,
} from './launcher';

/** Options the main bundle's `mountApp` receives. */
export interface MountOptions {
  publicKey: string;
  position: LauncherPosition;
  locale: string | null;
  origin: string;
  startOpen: boolean;
}

export type MountMain = (
  url: string,
  shadowRoot: ShadowRoot,
  options: MountOptions,
) => Promise<WidgetAppHandle>;

export interface LoaderOptions {
  /** Test seam: replaces the dynamic import of `main.js`. */
  mountMain?: MountMain;
  /** Test seam: replaces `console.warn`. */
  warn?: (message: string) => void;
}

export interface LoaderHandle {
  api: WidgetApi;
  host: LauncherHost;
}

/** Guards against a second copy of the snippet on the same page. */
const INSTALLED = '__ailoomWidgetInstalled';

function defaultMountMain(): MountMain {
  return async (url, shadowRoot, options) => {
    const module: unknown = await import(/* @vite-ignore */ url);
    const mount = (module as { mountApp?: unknown }).mountApp;
    if (typeof mount !== 'function') throw new Error('The widget bundle has no mountApp export.');
    return (mount as (root: ShadowRoot, opts: MountOptions) => Promise<WidgetAppHandle>)(
      shadowRoot,
      options,
    );
  };
}

/**
 * Reads the snippet's `data-*` attributes, defines `<ailoom-chat>` and publishes
 * `window.AiloomChat` (spec §16.1). Loading `main.js` is deferred until the widget first opens,
 * so a page that never opens the chat pays only for this IIFE.
 */
export function installLoader(
  script: HTMLScriptElement | null,
  options: LoaderOptions = {},
): LoaderHandle | null {
  if (script === null) return null;
  const document = script.ownerDocument;
  const win = document.defaultView;
  if (win === null) return null;

  const warn =
    options.warn ??
    ((message: string) => {
      win.console.warn(message);
    });
  const publicKey = script.dataset['key'];
  if (publicKey === undefined || publicKey === '') {
    warn('[ailoom] the widget script tag has no data-key; the widget was not loaded.');
    return null;
  }

  const globals = win as unknown as Record<string, unknown>;
  if (globals[INSTALLED] === true) return null;
  globals[INSTALLED] = true;

  const origin = new URL(script.src, win.location.href).origin;
  const position: LauncherPosition = script.dataset['position'] === 'left' ? 'left' : 'right';
  const locale = script.dataset['locale'] ?? null;
  const startOpen = script.dataset['open'] === 'true';

  defineLauncher(win.customElements);

  const host = document.createElement(WIDGET_ELEMENT) as LauncherHost;
  host.dataset['position'] = position;
  document.body.append(host);
  const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

  const mountMain = options.mountMain ?? defaultMountMain();
  const url = `${origin}/widget/${WIDGET_VERSION}/main.js`;
  const api = createApi(
    () => mountMain(url, shadowRoot, { publicKey, position, locale, origin, startOpen: false }),
    (error: unknown) => {
      warn(
        `[ailoom] the chat could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  );

  host.activate = () => {
    api.open();
  };
  (win as unknown as { AiloomChat?: WidgetApi }).AiloomChat = api;

  if (startOpen) api.open();
  return { api, host };
}

// The snippet's script element while this file executes; null when imported by a test.
if (typeof document !== 'undefined') {
  installLoader(document.currentScript as HTMLScriptElement | null);
}
