// SPDX-License-Identifier: MIT
import type { IdentifyContactRequest } from '@app/shared';

export type WidgetEventName = 'message' | 'open' | 'close';

export type WidgetEventHandler = () => void;

export interface WidgetLifecycleCallbacks {
  onOpenRequested?: () => void;
  onCloseRequested?: () => void;
}

/** What the lazy-loaded main bundle exposes to the loader. */
export interface WidgetAppHandle {
  open(): void;
  close(): void;
  identify(identity: IdentifyContactRequest): Promise<void>;
  on(event: WidgetEventName, handler: WidgetEventHandler): () => void;
}

/** The public `window.AiloomChat` surface. */
export interface WidgetApi {
  open(): void;
  close(): void;
  identify(identity: IdentifyContactRequest): Promise<void>;
  on(event: WidgetEventName, handler: WidgetEventHandler): () => void;
}

/**
 * The API callable before the main bundle exists (spec §16.1): `open()` loads on demand and the
 * call is replayed once the app mounts, while `on()` handlers are registered immediately and
 * forwarded to the mounted app. Load failures are reported once and do not throw into the
 * host page.
 */
export function createApi(
  load: () => Promise<WidgetAppHandle | null>,
  onLoadError: (error: unknown) => void,
  lifecycle: WidgetLifecycleCallbacks = {},
): WidgetApi {
  const handlers = new Map<WidgetEventName, Set<WidgetEventHandler>>();
  let handle: WidgetAppHandle | null = null;
  let loading: Promise<WidgetAppHandle | null> | null = null;
  let openWanted = false;

  const emit = (event: WidgetEventName): void => {
    for (const handler of handlers.get(event) ?? []) handler();
  };

  const ensureLoaded = (): Promise<WidgetAppHandle | null> => {
    loading ??= load()
      .then((mounted) => {
        handle = mounted;
        if (mounted !== null) {
          for (const event of ['message', 'open', 'close'] as const) {
            mounted.on(event, () => {
              emit(event);
            });
          }
        }
        return mounted;
      })
      .catch((error: unknown) => {
        onLoadError(error);
        return null;
      });
    return loading;
  };

  return {
    open() {
      openWanted = true;
      lifecycle.onOpenRequested?.();
      void ensureLoaded().then((mounted) => {
        if (mounted !== null && openWanted) mounted.open();
      });
    },
    close() {
      openWanted = false;
      lifecycle.onCloseRequested?.();
      handle?.close();
    },
    identify(identity) {
      return ensureLoaded().then((mounted) => {
        if (mounted === null) throw new Error('The chat widget could not be loaded.');
        return mounted.identify(identity);
      });
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
  };
}
