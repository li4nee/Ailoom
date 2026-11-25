// SPDX-License-Identifier: AGPL-3.0-only
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, notFound, Outlet } from '@tanstack/react-router';
import { Activity, BookOpen, Bot, MessagesSquare, Settings2 } from 'lucide-react';
import { useEffect } from 'react';

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { Badge } from '@/components/ui/badge';
import { loadMe, useMe } from '@/features/auth/api';
import { useConversationCounts } from '@/features/conversations/api';
import { fetchNotifications } from '@/features/notifications/api';
import { connectWorkspaceEvents } from '@/lib/events';
import { notifyInAppNotification } from '@/lib/notifications';
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
  ['/w/$workspaceId/bots', strings.nav.bots, Bot],
  ['/w/$workspaceId/knowledge', strings.nav.knowledge, BookOpen],
  ['/w/$workspaceId/conversations', strings.nav.conversations, MessagesSquare],
  ['/w/$workspaceId/usage', strings.nav.usage, Activity],
  ['/w/$workspaceId/settings', strings.nav.settings, Settings2],
] as const;

function WorkspaceLayout() {
  const { workspaceId } = Route.useParams();
  const queryClient = useQueryClient();
  const me = useMe().data;
  const membership = me?.memberships.find((m) => m.workspaceId === workspaceId);
  const counts = useConversationCounts(workspaceId);

  // One stream per workspace (spec §18.3): statuses and conversation lists stay fresh while
  // the user works. A new handoff also produces the opt-in desktop notification.
  useEffect(
    () =>
      connectWorkspaceEvents(
        workspaceId,
        (event) => {
          if (event.type === 'notification.created' && event.userId === me?.id) {
            void fetchNotifications(workspaceId)
              .then((page) => {
                const newest = page.data[0];
                if (newest !== undefined) notifyInAppNotification(newest, workspaceId);
              })
              .catch(() => undefined);
          }
        },
        { queryClient, ...(me?.id === undefined ? {} : { userId: me.id }) },
      ),
    [workspaceId, queryClient, me?.id],
  );

  if (membership === undefined) return null;

  return (
    <WorkspaceRoleProvider role={membership.role}>
      <div className="min-w-0">
        <nav aria-label={strings.nav.mainNav} className="sticky top-14 z-30 border-b bg-card">
          <div className="admin-page overflow-x-auto px-4 sm:px-6">
            <ul className="flex min-w-max gap-1 py-2">
              {NAV.map(([to, label, Icon]) => (
                <li key={to} className="shrink-0">
                  <Link
                    to={to}
                    params={{ workspaceId }}
                    className="workspace-nav-link inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm"
                    activeProps={{
                      className:
                        'workspace-nav-link inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm',
                      'aria-current': 'page',
                    }}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {label}
                    {to === '/w/$workspaceId/conversations' &&
                    (counts.data?.needsHuman ?? 0) > 0 ? (
                      <Badge className="ml-1 h-5 min-w-5 px-1.5" variant="destructive">
                        {String(counts.data?.needsHuman)}
                      </Badge>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <main id="main" className="admin-page min-w-0 px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </WorkspaceRoleProvider>
  );
}
