// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { UnansweredReport } from '@/features/usage/components/unanswered-report';

export const Route = createFileRoute('/_app/w/$workspaceId/usage/unanswered')({
  component: function UnansweredPage() {
    const { workspaceId } = Route.useParams();
    return <UnansweredReport workspaceId={workspaceId} />;
  },
});
