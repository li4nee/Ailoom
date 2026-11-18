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
  ] as const;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{strings.nav.settings}</h1>
      <nav aria-label={strings.nav.settings} className="flex gap-2 border-b">
        {tabs
          .filter(([, , visible]) => visible)
          .map(([to, label]) => (
            <Link
              key={to}
              to={to}
              params={{ workspaceId }}
              className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm"
              activeProps={{ className: 'border-primary font-medium', 'aria-current': 'page' }}
            >
              {label}
            </Link>
          ))}
      </nav>
      <Outlet />
    </div>
  );
}
