// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { TestRetrievalPanel } from '@/features/knowledge/components/test-retrieval-panel';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/knowledge/test')({
  component: function TestRetrievalPage() {
    const { workspaceId, botId } = Route.useParams();
    return <TestRetrievalPanel workspaceId={workspaceId} botId={botId} />;
  },
});
