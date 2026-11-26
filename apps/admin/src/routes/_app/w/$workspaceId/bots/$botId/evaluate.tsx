// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { EvaluatePage } from '@/features/eval/evaluate-page';

export const Route = createFileRoute('/_app/w/$workspaceId/bots/$botId/evaluate')({
  validateSearch: z.object({
    datasetId: z.uuid().optional().catch(undefined),
    promptVersionId: z.uuid().optional().catch(undefined),
    runId: z.uuid().optional().catch(undefined),
  }),
  component: function EvaluateRoute() {
    const { workspaceId, botId } = Route.useParams();
    const search = Route.useSearch();
    return (
      <EvaluatePage
        key={JSON.stringify([
          workspaceId,
          botId,
          search.datasetId,
          search.promptVersionId,
          search.runId,
        ])}
        workspaceId={workspaceId}
        botId={botId}
        selection={search}
      />
    );
  },
});
