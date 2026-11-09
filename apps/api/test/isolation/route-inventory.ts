// SPDX-License-Identifier: AGPL-3.0-only
import type { INestApplication } from '@nestjs/common';

/**
 * Extracts every registered HTTP route from a Nest application running on the
 * NodeAdapter. Reads the internal `NodeRouter` stack (radix tree route tables)
 * and normalises paths with the `/api` global prefix.
 *
 * Best effort: if the internal structure changes, returns `[]` rather than
 * throwing, so the route-inventory test degrades gracefully.
 */
export function listRoutes(app: INestApplication): { method: string; path: string }[] {
  const routes: { method: string; path: string }[] = [];

  try {
    const adapter = (app as { getHttpAdapter?: () => unknown }).getHttpAdapter?.();
    if (!adapter) return routes;

    const router = (adapter as { instance?: unknown }).instance;
    if (!router) return routes;

    const stack = (router as { stack?: unknown[] }).stack;
    if (!stack) return routes;

    for (const layer of stack) {
      const table = (layer as { table?: { routes?: unknown[] } } | undefined)?.table;
      if (!table?.routes) continue;

      for (const route of table.routes) {
        const method = (route as { method?: string | null }).method;
        const path = (route as { path?: string }).path;
        if (!method || !path) continue;

        routes.push({
          method,
          path: `/api${path}`,
        });
      }
    }
  } catch {
    // Best effort only
  }

  return routes;
}
