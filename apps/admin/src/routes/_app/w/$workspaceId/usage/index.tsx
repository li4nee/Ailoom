// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { UsageReport } from '@/features/usage/components/usage-report';

export const Route = createFileRoute('/_app/w/$workspaceId/usage/')({
  component: function UsagePage() {
    const { workspaceId } = Route.useParams();
    return <UsageReport workspaceId={workspaceId} />;
  },
});
