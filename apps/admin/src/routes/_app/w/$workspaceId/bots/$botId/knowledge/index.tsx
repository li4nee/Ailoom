// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link } from '@tanstack/react-router';

import { RoleGate } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { AddSourceDialog } from '@/features/knowledge/components/add-source-dialog';
import { SourcesTable } from '@/features/knowledge/components/sources-table';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/knowledge/')({
  component: function KnowledgePage() {
    const { workspaceId, botId } = Route.useParams();
    return (
      <div className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{strings.knowledge.title}</h1>
            <p className="text-sm text-muted-foreground">{strings.knowledge.intro}</p>
          </div>
          <RoleGate min="admin">
            <div className="flex items-center gap-2">
              <Button asChild variant="outline">
                <Link
                  to="/w/$workspaceId/bots/$botId/knowledge/test"
                  params={{ workspaceId, botId }}
                >
                  {strings.knowledge.testRetrieval}
                </Link>
              </Button>
              <AddSourceDialog workspaceId={workspaceId} botId={botId} />
            </div>
          </RoleGate>
        </header>
        <SourcesTable workspaceId={workspaceId} botId={botId} />
      </div>
    );
  },
});
