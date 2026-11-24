// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link } from '@tanstack/react-router';

import { SuggestionsQueue } from '@/features/knowledge/components/suggestions-queue';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/knowledge/suggestions')({
  component: function KnowledgeSuggestionsPage() {
    const { workspaceId } = Route.useParams();
    return (
      <div className="space-y-4">
        <header className="space-y-2">
          <Link
            to="/w/$workspaceId/knowledge"
            params={{ workspaceId }}
            className="text-sm underline underline-offset-4"
          >
            {strings.nav.knowledge}
          </Link>
          <h1 className="text-2xl font-semibold">{strings.knowledge.suggestions}</h1>
        </header>
        <SuggestionsQueue workspaceId={workspaceId} />
      </div>
    );
  },
});
