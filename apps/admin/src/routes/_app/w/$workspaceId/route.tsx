// SPDX-License-Identifier: AGPL-3.0-only
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, notFound, Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { loadMe, useMe } from '@/features/auth/api';
import { connectWorkspaceEvents } from '@/lib/events';
import { strings } from '@/strings';

/** A workspace the user belongs to; anything else is a 404, exactly as the API answers. */
export const Route = createFileRoute('/_app/w/$workspaceId')({
  beforeLoad: async ({ context, params }) => {
    const me = await loadMe(context.queryClient);
    if (!me?.memberships.some((m) => m.workspaceId === params.workspaceId)) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router API
      throw notFound();
    }
  },
  component: WorkspaceLayout,
});

const NAV = [
  ['/w/$workspaceId/bots', strings.nav.bots],
  ['/w/$workspaceId/knowledge', strings.nav.knowledge],
  ['/w/$workspaceId/conversations', strings.nav.conversations],
  ['/w/$workspaceId/usage', strings.nav.usage],
  ['/w/$workspaceId/settings', strings.nav.settings],
] as const;

function WorkspaceLayout() {
  const { workspaceId } = Route.useParams();
  const queryClient = useQueryClient();
  const membership = useMe().data?.memberships.find((m) => m.workspaceId === workspaceId);

  // One stream per workspace (spec §18.3): statuses and conversation lists stay fresh while
  // the user works. The cleanup closes it when they switch workspace.
  useEffect(
    () => connectWorkspaceEvents(workspaceId, undefined, { queryClient }),
    [workspaceId, queryClient],
  );

  if (membership === undefined) return null;

  return (
    <WorkspaceRoleProvider role={membership.role}>
      <div className="flex">
        <nav aria-label={strings.nav.mainNav} className="w-48 shrink-0 border-r p-3">
          <ul className="space-y-1">
            {NAV.map(([to, label]) => (
              <li key={to}>
                <Link
                  to={to}
                  params={{ workspaceId }}
                  className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
                  activeProps={{ className: 'bg-accent font-medium', 'aria-current': 'page' }}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </WorkspaceRoleProvider>
  );
}
