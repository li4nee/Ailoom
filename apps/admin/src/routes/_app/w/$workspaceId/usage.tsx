// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { strings } from '@/strings';

const OUTCOMES_TAB = ['/w/$workspaceId/usage', strings.usage.outcomes] as const;
const USAGE_TAB = ['/w/$workspaceId/usage/usage', strings.usage.usageAndCost] as const;
const QUALITY_TABS = [
  ['/w/$workspaceId/usage/unanswered', strings.usage.unanswered],
  ['/w/$workspaceId/usage/feedback', strings.usage.feedback],
] as const;

export const Route = createFileRoute('/_app/w/$workspaceId/usage')({
  component: function UsageLayout() {
    const { workspaceId } = Route.useParams();
    const isAdmin = hasRole(useWorkspaceRole(), 'admin');
    const tabs = isAdmin ? [OUTCOMES_TAB, USAGE_TAB, ...QUALITY_TABS] : [OUTCOMES_TAB, USAGE_TAB];
    return (
      <div className="space-y-4">
        <nav aria-label={strings.nav.usage} className="flex flex-wrap gap-2 border-b pb-2">
          {tabs.map(([to, label]) => (
            <Link
              key={to}
              to={to}
              params={{ workspaceId }}
              className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
              activeProps={{ className: 'bg-accent font-medium', 'aria-current': 'page' }}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Outlet />
      </div>
    );
  },
});
