// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/settings')({
  component: SettingsLayout,
});

function SettingsLayout() {
  const { workspaceId } = Route.useParams();
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const tabs = [
    ['/w/$workspaceId/settings/general', strings.nav.general, true],
    ['/w/$workspaceId/settings/members', strings.nav.members, isAdmin],
    ['/w/$workspaceId/settings/credentials', strings.nav.credentials, isAdmin],
    ['/w/$workspaceId/settings/integrations', strings.nav.integrations, isAdmin],
    ['/w/$workspaceId/settings/invitations', strings.nav.invitations, isAdmin],
    ['/w/$workspaceId/settings/audit-log', strings.nav.auditLog, isAdmin],
    ['/w/$workspaceId/settings/saved-replies', strings.nav.savedReplies, isAdmin],
    ['/w/$workspaceId/settings/operations', strings.nav.agentOperations, true],
    ['/w/$workspaceId/settings/notifications', strings.nav.notificationPreferences, true],
  ] as const;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{strings.nav.settings}</h1>
      <nav
        aria-label={strings.nav.settings}
        className="grid grid-cols-2 gap-1 border-b sm:flex sm:gap-2"
      >
        {tabs
          .filter(([, , visible]) => visible)
          .map(([to, label]) => (
            <Link
              key={to}
              to={to}
              params={{ workspaceId }}
              className="-mb-px min-w-0 border-b-2 border-transparent px-3 py-2 text-left text-sm sm:flex-none sm:text-center"
              activeProps={{
                className:
                  '-mb-px min-w-0 border-b-2 border-primary bg-primary/10 px-3 py-2 text-left text-sm font-medium sm:flex-none sm:text-center',
                'aria-current': 'page',
              }}
            >
              {label}
            </Link>
          ))}
      </nav>
      <Outlet />
    </div>
  );
}
