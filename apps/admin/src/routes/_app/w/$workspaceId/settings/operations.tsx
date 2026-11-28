// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { OperationsSettings } from '@/features/agent-operations/components/operations-settings';

export const Route = createFileRoute('/_app/w/$workspaceId/settings/operations')({
  component: OperationsPage,
});

function OperationsPage() {
  const { workspaceId } = Route.useParams();
  return <OperationsSettings workspaceId={workspaceId} />;
}
