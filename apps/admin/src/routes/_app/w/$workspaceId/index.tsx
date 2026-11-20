// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight, BookOpen, Bot, MessagesSquare } from 'lucide-react';

import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConversationCounts } from '@/features/conversations/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/')({ component: WorkspaceOverview });

const QUICK_LINKS = [
  { to: '/w/$workspaceId/bots', label: strings.nav.bots, Icon: Bot },
  { to: '/w/$workspaceId/knowledge', label: strings.nav.knowledge, Icon: BookOpen },
  { to: '/w/$workspaceId/conversations', label: strings.nav.conversations, Icon: MessagesSquare },
] as const;

function WorkspaceOverview() {
  const { workspaceId } = Route.useParams();
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const counts = useConversationCounts(workspaceId);

  return (
    <div className="space-y-7">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="ledger-heading text-3xl">{strings.workspaces.overview}</h1>
            <p className="text-sm text-muted-foreground">{strings.workspaces.overviewIntro}</p>
          </div>
          {isAdmin ? (
            <Button asChild>
              <Link to="/w/$workspaceId/bots/new" params={{ workspaceId }}>
                {strings.bots.newBot}
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <section className="ledger-panel space-y-5 p-5 sm:p-6">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="ledger-heading">{strings.workspaces.needsHumanQueue}</h2>
              <p className="text-sm text-muted-foreground">{strings.conversations.intro}</p>
            </div>
            <Button asChild variant="outline">
              <Link to="/w/$workspaceId/conversations" params={{ workspaceId }}>
                {strings.workspaces.openInbox}
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          </header>

          {counts.isLoading ? (
            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2" role="status">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : counts.error ? (
            <FormAlert message={errorMessage(counts.error)} />
          ) : counts.data === undefined ? null : (
            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  {strings.workspaces.needsHumanQueue}
                </p>
                <p className="text-3xl font-semibold tabular-nums">
                  {String(counts.data.needsHuman)}
                </p>
              </div>
              <div className="space-y-1 border-border sm:border-l sm:pl-5">
                <p className="text-sm text-muted-foreground">{strings.workspaces.assignedToMe}</p>
                <p className="text-3xl font-semibold tabular-nums">{String(counts.data.mine)}</p>
              </div>
            </div>
          )}
        </section>

        <nav
          className="ledger-panel overflow-hidden"
          aria-label={strings.workspaces.workspaceTools}
        >
          <h2 className="px-5 pb-3 pt-5 text-sm font-semibold">
            {strings.workspaces.workspaceTools}
          </h2>
          <ul className="divide-y divide-border">
            {QUICK_LINKS.map(({ to, label, Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  params={{ workspaceId }}
                  className="group flex min-h-14 items-center gap-3 px-5 text-sm hover:bg-secondary/70"
                >
                  <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                  <span className="flex-1">{label}</span>
                  {to === '/w/$workspaceId/conversations' && (counts.data?.needsHuman ?? 0) > 0 ? (
                    <Badge variant="destructive">{String(counts.data?.needsHuman)}</Badge>
                  ) : null}
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
