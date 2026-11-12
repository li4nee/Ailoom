// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { RoleGate } from '@/components/role-gate';
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
            <AddSourceDialog workspaceId={workspaceId} botId={botId} />
          </RoleGate>
        </header>
        <SourcesTable workspaceId={workspaceId} botId={botId} />
      </div>
    );
  },
});
