// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId')({
  component: function BotLayout() {
    const { workspaceId, botId } = Route.useParams();
    const tabs = [
      ['/w/$workspaceId/bots/$botId/general', strings.bots.tabs.general],
      ['/w/$workspaceId/bots/$botId/model', strings.bots.tabs.model],
      ['/w/$workspaceId/bots/$botId/appearance', strings.bots.tabs.appearance],
      ['/w/$workspaceId/bots/$botId/behavior', strings.bots.tabs.behavior],
      ['/w/$workspaceId/bots/$botId/instructions', strings.bots.tabs.instructions],
      ['/w/$workspaceId/bots/$botId/install', strings.bots.tabs.install],
    ] as const;

    return (
      <div className="space-y-6">
        <nav aria-label={strings.bots.title} className="flex flex-wrap gap-2 border-b">
          {tabs.map(([to, label]) => (
            <Link
              key={to}
              to={to}
              params={{ workspaceId, botId }}
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
  },
});
