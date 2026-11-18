// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { RoleGate } from '@/components/role-gate';
import { IntegrationsSettings } from '@/features/integrations/components/integrations-settings';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/settings/integrations')({
  component: function IntegrationsPage() {
    const { workspaceId } = Route.useParams();
    return (
      <RoleGate min="admin">
        <h2 className="sr-only">{strings.integrations.title}</h2>
        <IntegrationsSettings workspaceId={workspaceId} />
      </RoleGate>
    );
  },
});
