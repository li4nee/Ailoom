// SPDX-License-Identifier: AGPL-3.0-only
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';

import { Toaster } from '@/components/ui/sonner';
import { strings } from '@/strings';

export interface RouterContext {
  queryClient: QueryClient;
}

function NotFound() {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <p className="mb-4">{strings.app.notFound}</p>
      <Link to="/" className="text-primary underline">
        {strings.app.backHome}
      </Link>
    </main>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
  notFoundComponent: NotFound,
});
