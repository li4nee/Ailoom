// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { useBot } from '@/features/bots/api';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId')({
  component: function BotLayout() {
    const { workspaceId, botId } = Route.useParams();
    const bot = useBot(workspaceId, botId);
    const tabs = [
      ['/w/$workspaceId/bots/$botId/general', strings.bots.tabs.general],
      ['/w/$workspaceId/bots/$botId/model', strings.bots.tabs.model],
      ['/w/$workspaceId/bots/$botId/knowledge', strings.bots.tabs.knowledge],
      ['/w/$workspaceId/bots/$botId/playground', strings.bots.tabs.playground],
      ['/w/$workspaceId/bots/$botId/appearance', strings.bots.tabs.appearance],
      ['/w/$workspaceId/bots/$botId/behavior', strings.bots.tabs.behavior],
      ['/w/$workspaceId/bots/$botId/instructions', strings.bots.tabs.instructions],
      ['/w/$workspaceId/bots/$botId/install', strings.bots.tabs.install],
    ] as const;

    return (
      <div className="space-y-6">
        <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="ledger-heading break-words text-2xl">
              {bot.data?.name ?? strings.bots.title}
            </h1>
            {bot.data === undefined ? null : (
              <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="break-words">
                  {strings.bots.chatModel}: {bot.data.chatModel}
                </span>
                <span className="break-words">
                  {strings.bots.embeddingModel}: {bot.data.embeddingModel}
                </span>
              </div>
            )}
          </div>
          <Link
            to="/w/$workspaceId/bots"
            params={{ workspaceId }}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {strings.bots.title}
          </Link>
        </header>
        <nav
          aria-label={strings.bots.title}
          className="grid grid-cols-2 gap-x-1 border-b sm:flex sm:gap-2"
        >
          {tabs.map(([to, label]) => (
            <Link
              key={to}
              to={to}
              params={{ workspaceId, botId }}
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
  },
});
