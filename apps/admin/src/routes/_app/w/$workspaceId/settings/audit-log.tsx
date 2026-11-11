// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { RoleGate } from '@/components/role-gate';
import { AuditLogTable } from '@/features/audit/components/audit-log-table';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/settings/audit-log')({
  component: function AuditLogPage() {
    const { workspaceId } = Route.useParams();
    return (
      <RoleGate min="admin">
        <h2 className="sr-only">{strings.audit.title}</h2>
        <AuditLogTable workspaceId={workspaceId} />
      </RoleGate>
    );
  },
});
