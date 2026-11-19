// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight, Bot, BookOpen } from 'lucide-react';

import { FormAlert } from '@/components/form-alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useBots } from '@/features/bots/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/knowledge')({
  component: function KnowledgeIndexPage() {
    const { workspaceId } = Route.useParams();
    const bots = useBots(workspaceId);

    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">{strings.nav.knowledge}</h1>
          <p className="text-sm text-muted-foreground">{strings.knowledge.pickBot}</p>
        </div>
        {bots.isError ? <FormAlert message={errorMessage(bots.error)} /> : null}
        {bots.isPending ? <Skeleton className="h-32 w-full" /> : null}
        {bots.isSuccess ? (
          bots.data.length === 0 ? (
            <section className="ledger-panel flex flex-col items-start gap-3 p-6">
              <span className="grid size-10 place-items-center rounded-lg bg-secondary text-muted-foreground">
                <BookOpen aria-hidden="true" className="size-5" />
              </span>
              <div className="space-y-1">
                <h2 className="font-semibold">{strings.bots.empty}</h2>
                <p className="text-sm text-muted-foreground">{strings.knowledge.pickBot}</p>
              </div>
              <Link
                to="/w/$workspaceId/bots"
                params={{ workspaceId }}
                className="text-sm font-medium underline underline-offset-4"
              >
                {strings.nav.bots}
              </Link>
            </section>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {bots.data.map((bot) => (
                <li key={bot.id}>
                  <Link
                    to="/w/$workspaceId/bots/$botId/knowledge"
                    params={{ workspaceId, botId: bot.id }}
                    className="ledger-panel group flex min-h-32 items-start gap-4 p-5 transition-colors hover:border-primary/50 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-foreground">
                      <Bot aria-hidden="true" className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{bot.name}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {strings.knowledge.sources}
                      </span>
                    </span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    );
  },
});
