// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { SourceDetail } from '@/features/knowledge/components/source-detail';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/knowledge/$sourceId')({
  component: function SourcePage() {
    const { workspaceId, botId, sourceId } = Route.useParams();
    return <SourceDetail workspaceId={workspaceId} botId={botId} sourceId={sourceId} />;
  },
});
