// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { EvaluatePage } from '@/features/eval/evaluate-page';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/evaluate')({
  component: function EvaluateRoute() {
    const { workspaceId, botId } = Route.useParams();
    return <EvaluatePage workspaceId={workspaceId} botId={botId} />;
  },
});
