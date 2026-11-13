// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link } from '@tanstack/react-router';

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
            <p className="text-sm text-muted-foreground">{strings.bots.empty}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {bots.data.map((bot) => (
                <li key={bot.id}>
                  <Link
                    to="/w/$workspaceId/bots/$botId/knowledge"
                    params={{ workspaceId, botId: bot.id }}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <span className="font-medium">{bot.name}</span>
                    <span className="text-muted-foreground">{strings.knowledge.sources}</span>
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
