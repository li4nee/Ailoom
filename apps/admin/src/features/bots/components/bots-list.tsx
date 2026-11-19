// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Bot, Cpu, KeyRound } from 'lucide-react';

import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useBots } from '../api';

export function BotsList({ workspaceId }: { workspaceId: string }) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const bots = useBots(workspaceId);

  if (bots.isError) return <FormAlert message={errorMessage(bots.error)} />;
  if (bots.isPending) return <Skeleton className="h-32 w-full" />;
  const rows = bots.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{strings.bots.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.bots.intro}</p>
        </div>
        {isAdmin ? (
          <Button asChild>
            <Link to="/w/$workspaceId/bots/new" params={{ workspaceId }}>
              {strings.bots.newBot}
            </Link>
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <section className="ledger-panel flex flex-col items-start gap-3 p-6">
          <span className="grid size-10 place-items-center rounded-lg bg-secondary text-muted-foreground">
            <Bot aria-hidden="true" className="size-5" />
          </span>
          <div className="space-y-1">
            <h2 className="font-semibold">{strings.bots.empty}</h2>
            <p className="text-sm text-muted-foreground">{strings.bots.intro}</p>
          </div>
          {isAdmin ? (
            <Button asChild>
              <Link to="/w/$workspaceId/bots/new" params={{ workspaceId }}>
                {strings.bots.newBot}
              </Link>
            </Button>
          ) : null}
        </section>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {rows.map((bot) => (
            <li key={bot.id}>
              <Link
                to="/w/$workspaceId/bots/$botId/general"
                params={{ workspaceId, botId: bot.id }}
                className="ledger-panel group flex h-full flex-col gap-5 p-5 transition-colors hover:border-primary/50 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-foreground">
                    <Bot aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-semibold">{bot.name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{strings.bots.name}</p>
                  </div>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  />
                </div>
                <dl className="grid gap-3 border-t border-border pt-4 text-sm">
                  <div className="flex min-w-0 items-start gap-2">
                    <Cpu
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{strings.bots.chatModel}</dt>
                      <dd className="truncate font-medium">{bot.chatModel}</dd>
                    </div>
                  </div>
                  <div className="flex min-w-0 items-start gap-2">
                    <Cpu
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">
                        {strings.bots.embeddingModel}
                      </dt>
                      <dd className="truncate font-medium">{bot.embeddingModel}</dd>
                    </div>
                  </div>
                  <div className="flex min-w-0 items-start gap-2">
                    <KeyRound
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{strings.bots.publicKey}</dt>
                      <dd className="truncate font-mono text-xs">{bot.publicKey}</dd>
                    </div>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
