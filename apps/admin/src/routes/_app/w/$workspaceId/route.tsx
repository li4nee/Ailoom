// SPDX-License-Identifier: AGPL-3.0-only
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, notFound, Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { Badge } from '@/components/ui/badge';
import { loadMe, useMe } from '@/features/auth/api';
import { fetchConversation, useConversationCounts } from '@/features/conversations/api';
import { needsHumanNotification } from '@/features/conversations/notifications';
import { connectWorkspaceEvents } from '@/lib/events';
import { notifyNeedsHuman } from '@/lib/notifications';
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
  const counts = useConversationCounts(workspaceId);

  // One stream per workspace (spec §18.3): statuses and conversation lists stay fresh while
  // the user works. A new handoff also produces the opt-in desktop notification.
  useEffect(
    () =>
      connectWorkspaceEvents(
        workspaceId,
        (event) => {
          if (event.type === 'conversation.updated' && event.status === 'needs_human') {
            void fetchConversation(workspaceId, event.conversationId)
              .then((detail) => {
                notifyNeedsHuman(needsHumanNotification(detail, workspaceId));
              })
              .catch(() => undefined);
          }
        },
        { queryClient },
      ),
    [workspaceId, queryClient],
  );

  if (membership === undefined) return null;

  return (
    <WorkspaceRoleProvider role={membership.role}>
      <div className="flex min-w-0 flex-col md:flex-row">
        <nav
          aria-label={strings.nav.mainNav}
          className="w-full shrink-0 border-b p-3 md:w-48 md:border-r md:border-b-0"
        >
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:space-y-1">
            {NAV.map(([to, label]) => (
              <li key={to} className="shrink-0">
                <Link
                  to={to}
                  params={{ workspaceId }}
                  className="block whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-accent"
                  activeProps={{ className: 'bg-accent font-medium', 'aria-current': 'page' }}
                >
                  {label}
                  {to === '/w/$workspaceId/conversations' && (counts.data?.needsHuman ?? 0) > 0 ? (
                    <Badge className="ml-2" variant="destructive">
                      {String(counts.data?.needsHuman)}
                    </Badge>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </WorkspaceRoleProvider>
  );
}
