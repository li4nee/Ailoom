// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { Playground } from '@/features/playground/components/playground';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/playground')({
  component: function PlaygroundPage() {
    const { workspaceId, botId } = Route.useParams();
    return <Playground workspaceId={workspaceId} botId={botId} />;
  },
});
