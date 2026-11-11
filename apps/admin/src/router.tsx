// SPDX-License-Identifier: AGPL-3.0-only
import { createRouter } from '@tanstack/react-router';

import { configureApiClient } from './lib/api-client';
import { createQueryClient } from './lib/query-client';
import { routeTree } from './routeTree.gen';

export function createAppRouter() {
  const queryClient = createQueryClient();
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
  // A lost session drops every cached query (they belong to the old user); the client's
  // default then sends the browser to /login?next=<where they were>.
  configureApiClient({
    onSessionLost: (next) => {
      queryClient.clear();
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    },
  });
  return { router, queryClient };
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>['router'];
  }
}
